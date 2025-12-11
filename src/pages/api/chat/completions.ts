import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "crypto";
import { getNearAIClient, NearAIError, NearAITimeoutError } from "@/lib/near-ai";
import { extractChatId } from "@/lib/verification";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ToolChoice,
} from "@/types/near-ai";
import { z } from "zod";

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: unknown;
  [key: string]: unknown;
};

type ChatCompletionRequestPayload = {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  verification?: { id: string; nonce: string };
  timeout?: number;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: unknown;
  tool_choice?: unknown;
};

const MAX_REQUEST_BYTES = 200_000; // ~200KB guardrail
const STREAM_LOG_BUFFER_CAP = 50_000; // avoid unbounded in-memory logs
const shouldLogVerification = process.env.NODE_ENV === "development";

const chatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.string().min(1),
        content: z.union([z.string(), z.null()]).optional(),
        tool_calls: z.unknown().optional(),
      })
    )
    .min(1),
  stream: z.boolean().optional(),
  verificationId: z.string().optional(),
  verificationNonce: z.string().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  tools: z.unknown().optional(),
  tool_choice: z.unknown().optional(),
  timeout: z.number().optional(),
});

/**
 * POST /api/chat/completions
 *
 * Server-side proxy for NEAR AI Cloud API.
 *
 * NEAR AI Cloud provides:
 * - Private inference in Trusted Execution Environments (TEEs)
 * - Unified API for multiple AI models
 * - Verifiable AI computations
 *
 * Currently supported models (as of 2025):
 *
 * 1. deepseek-ai/DeepSeek-V3.1 (Recommended for most use cases)
 *    - 128K context | $1/M input | $2.5/M output
 *    - Hybrid thinking/non-thinking mode
 *    - Excellent tool calling & agent tasks
 *    - Fast reasoning with high quality
 *
 * 2. openai/gpt-oss-120b (Best for reasoning & agents)
 *    - 131K context | $0.2/M input | $0.6/M output
 *    - 117B MoE model from OpenAI
 *    - Configurable reasoning depth
 *    - Native tool use & function calling
 *
 * 3. Qwen/Qwen3-30B-A3B-Instruct-2507 (Ultra-long context)
 *    - 262K context | $0.15/M input | $0.45/M output
 *    - 30.5B MoE model
 *    - Non-thinking mode only
 *    - Strong multilingual & reasoning
 *
 * 4. Zhipu/GLM-4.6-FP8 (Premium quality)
 *    - 131K context | $0.75/M input | $2/M output
 *    - 358B parameters (FP8 quantized)
 *    - Advanced coding & multi-step reasoning
 *    - Competitor to Claude Sonnet 4
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Basic payload size guardrail (after Next.js JSON parsing)
  const rawBody = JSON.stringify(req.body ?? {});
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    return res.status(413).json({
      error: "Request too large",
      message: "Request body exceeds maximum size",
    });
  }

  const parsedBody = chatRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid request body",
      message: parsedBody.error.issues.map((i) => i.message).join("; "),
    });
  }

  // Initialize client (will throw if API key not configured)
  let client;
  try {
    client = getNearAIClient();
  } catch (error) {
    console.error("NEAR_AI_CLOUD_API_KEY not configured");
    return res.status(500).json({
      error: "API key not configured on server",
      message: "Get your API key from https://cloud.near.ai",
    });
  }

  const {
    model,
    messages,
    stream,
    verificationId,
    verificationNonce,
    temperature,
    max_tokens,
    top_p,
    frequency_penalty,
    presence_penalty,
    tools,
    tool_choice,
  } = parsedBody.data;

  try {
    // Build request body with optional parameters
    const requestBody: ChatCompletionRequest = {
      model,
      messages,
      stream: Boolean(stream),
    };

    // Add optional OpenAI-compatible parameters
    if (temperature !== undefined) requestBody.temperature = temperature;
    if (max_tokens !== undefined) requestBody.max_tokens = max_tokens;
    if (top_p !== undefined) requestBody.top_p = top_p;
    if (frequency_penalty !== undefined)
      requestBody.frequency_penalty = frequency_penalty;
    if (presence_penalty !== undefined)
      requestBody.presence_penalty = presence_penalty;
    if (tools !== undefined) requestBody.tools = tools;
    if (tool_choice !== undefined && tool_choice !== null) {
      requestBody.tool_choice = tool_choice as ToolChoice;
    }

    // Hash body BEFORE adding verification (headers carry verification)
    const requestBodyString = JSON.stringify(requestBody);
    const requestHash = createHash("sha256")
      .update(requestBodyString)
      .digest("hex");

    if (shouldLogVerification) {
      console.log("[verification] Pre-request:", {
        verificationId: verificationId || null,
        nonce: verificationNonce || null,
        requestHash,
        requestBodyLength: requestBodyString.length,
      });
    }

    // If streaming, use streaming method
    if (stream) {
      let response;
      try {
        response = await client.chatCompletionsStream(requestBody, {
          verificationId,
          verificationNonce,
        });
      } catch (error) {
        console.error("NEAR AI Cloud API error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const statusCode =
          error instanceof Error && "statusCode" in error
            ? (error as { statusCode?: number }).statusCode || 500
            : 500;
        return res.status(statusCode).json({
          error: `NEAR AI Cloud API Error: ${statusCode}`,
          details: errorMessage,
        });
      }

      if (!response.body) {
        return res.status(500).json({
          error: "Failed to get response stream",
        });
      }

      const upstreamContentType = response.headers.get("content-type") ?? "";
      const isEventStream = upstreamContentType.includes("text/event-stream");

      if (isEventStream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
      } else {
        if (upstreamContentType) {
          res.setHeader("Content-Type", upstreamContentType);
        }
        const cacheControl = response.headers.get("cache-control");
        if (cacheControl) {
          res.setHeader("Cache-Control", cacheControl);
        }
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const hash = verificationId ? createHash("sha256") : null;
      let rawResponseBuffer = "";
      let accumulatedResponse = "";
      let loggedLength = 0;
      let totalBytes = 0;
      let aborted = false;

      const abortReader = async () => {
        aborted = true;
        try {
          await reader.cancel();
        } catch {
          // ignore cancellation errors
        }
      };

      const handleClose = () => {
        abortReader();
      };

      req.on("close", handleClose);
      res.on("close", handleClose);

      // Pre-register verification session
      if (verificationId) {
        client.createSession(verificationId, verificationNonce ?? undefined);
        client.updateSessionHashes(verificationId, { requestHash });
      }

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (aborted) break;

          if (value) {
            const chunkText = decoder.decode(value, { stream: true });
            accumulatedResponse += chunkText;
            hash?.update(value);
            totalBytes += value.byteLength;

            if (loggedLength < STREAM_LOG_BUFFER_CAP) {
              const remaining = STREAM_LOG_BUFFER_CAP - loggedLength;
              rawResponseBuffer += chunkText.slice(0, remaining);
              loggedLength = rawResponseBuffer.length;
            }

            // Write exact bytes without modification
            res.write(value);
          }

          if (done) break;
        }

        const finalChunk = decoder.decode();
        if (finalChunk) {
          accumulatedResponse += finalChunk;
          const remaining = STREAM_LOG_BUFFER_CAP - loggedLength;
          if (remaining > 0) {
            rawResponseBuffer += finalChunk.slice(0, remaining);
            loggedLength = rawResponseBuffer.length;
          }
          hash?.update(finalChunk);
          res.write(finalChunk);
        }

        if (verificationId && !aborted && hash) {
          const responseHash = hash.digest("hex");
          client.updateSessionHashes(verificationId, { requestHash, responseHash });
          if (shouldLogVerification) {
            console.log("[verification] Stream complete:", {
              verificationId,
              rawResponseLength: totalBytes,
              bufferedLength: rawResponseBuffer.length,
              bufferTruncated: totalBytes > rawResponseBuffer.length,
            });
          }
          const chatId = extractChatId(accumulatedResponse);
          if (chatId) {
            try {
              const verificationResult = await client.verifyChatPayload({
                requestBody: requestBodyString,
                responseText: accumulatedResponse,
                chatId,
                model,
              });
              if (shouldLogVerification) {
                console.log("[verification] Stream verification result:", {
                  verificationResult,
                });
              }
            } catch (streamVerificationError) {
              console.warn(
                "[verification] Stream verification failed:",
                streamVerificationError
              );
            }
          }
        } else if (shouldLogVerification && !aborted && verificationId) {
          console.log("[verification] Stream complete (no hash)", {
            verificationId,
            rawResponseLength: totalBytes,
            bufferedLength: rawResponseBuffer.length,
          });
        }
      } catch (streamError) {
        if (!aborted) {
          console.error("Stream error:", streamError);
        }
      } finally {
        req.off("close", handleClose);
        res.off("close", handleClose);
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    } else {
      try {
        const responseData = await client.chatCompletions(requestBody, {
          verificationId,
          verificationNonce,
          timeout: parsedBody.data?.timeout,
        });

        const responseText = JSON.stringify(responseData);
        const responseHash = createHash("sha256")
          .update(responseText)
          .digest("hex");

        const verificationResult = await client.verifyChatPayload({
          requestBody: requestBodyString,
          responseText,
          chatId: String(responseData?.id ?? ""),
          model,
        });

        const payload = responseData as ChatCompletionResponse &
          Record<string, unknown>;
        payload.verification = verificationResult;
        payload.verificationId = responseData?.id ?? null;

        res.status(200).json(payload);
      } catch (error: unknown) {
        console.error("NEAR AI Cloud API error:", error);

        if (error instanceof NearAITimeoutError) {
          return res.status(504).json({
            error: "Request timeout",
            details: error.message,
          });
        }

        if (error instanceof NearAIError) {
          const statusCode = error.statusCode ?? 500;
          return res.status(statusCode).json({
            error: `NEAR AI Cloud API Error: ${statusCode}`,
            details: error.message,
          });
        }

        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        return res.status(500).json({
          error: "NEAR AI Cloud API Error",
          details: message,
        });
      }
    }
  } catch (error: unknown) {
    console.error("Proxy error:", error);

    // Check if headers already sent
    if (res.headersSent) {
      console.error("Cannot send error response - headers already sent");
      return;
    }

    // Handle timeout
    if (error instanceof Error && error.name === "AbortError") {
      return res.status(504).json({
        error: "Request timeout",
        message: "The AI model took too long to respond",
      });
    }

    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({
      error: "Failed to proxy request",
      message,
    });
  }
}
