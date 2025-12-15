import type { NextApiRequest, NextApiResponse } from "next";
import {
  getNearAIClient,
  NearAIError,
  NearAITimeoutError,
  verifyChatMessage,
} from "@/lib/near-ai";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "@/lib/near-ai";
import { z, ZodError } from "zod";
import { logger } from "@/lib/logger";
import {
  ChatCompletionRequestInput,
  normalizeChatCompletionRequest,
  serializeChatCompletionRequest,
  toolChoiceSchema,
} from "@/lib/near-ai/request";
import type { NormalizedChatCompletionRequest } from "@/lib/near-ai/request";

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  [key: string]: unknown;
};

type ChatCompletionRequestPayload = {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
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
      tool_calls: z.array(z.unknown()).optional(),
      })
    )
    .min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  tools: z.unknown().optional(),
  tool_choice: z.unknown().optional(),
  timeout: z.number().optional(),
});

const formatZodErrorMessages = (error: ZodError) =>
  error.issues.map((issue) => issue.message).join("; ");

const respondWithChatError = (
  res: NextApiResponse,
  status: number,
  error: string,
  options?: { message?: string; details?: unknown }
) => {
  const payload: Record<string, unknown> = { error };
  if (options?.message !== undefined) {
    payload.message = options.message;
  }
  if (options?.details !== undefined) {
    payload.details = options.details;
  }
  return res.status(status).json(payload);
};

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
    return respondWithChatError(res, 405, "Method not allowed");
  }

  // Basic payload size guardrail (after Next.js JSON parsing)
  const rawBody = JSON.stringify(req.body ?? {});
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    return respondWithChatError(res, 413, "Request too large");
  }

  const parsedBody = chatRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return respondWithChatError(res, 400, "Invalid request body", {
      message: formatZodErrorMessages(parsedBody.error),
    });
  }

  // Initialize client (will throw if API key not configured)
  let client;
  try {
    client = getNearAIClient();
  } catch (error) {
    logger.error("NEAR_AI_CLOUD_API_KEY not configured");
    const details =
      process.env.NODE_ENV === "development"
        ? "Get your API key from https://cloud.near.ai"
        : undefined;
    return respondWithChatError(res, 500, "API key not configured on server", {
      details,
    });
  }

  const {
    model,
    messages,
    stream,
    temperature,
    max_tokens,
    top_p,
    frequency_penalty,
    presence_penalty,
    tools,
    tool_choice,
  } = parsedBody.data;

  try {

    const toolsArray = Array.isArray(tools) ? tools : undefined;

    let normalizedToolChoice:
      | z.infer<typeof toolChoiceSchema>
      | undefined = undefined;
    if (tool_choice !== undefined && tool_choice !== null) {
      const toolChoiceParse = toolChoiceSchema.safeParse(tool_choice);
      if (!toolChoiceParse.success) {
        return respondWithChatError(res, 400, "Invalid request body", {
          message: formatZodErrorMessages(toolChoiceParse.error),
        });
      }
      normalizedToolChoice = toolChoiceParse.data;
    }

    const requestInput: ChatCompletionRequestInput = {
      model,
      messages,
      stream: Boolean(stream),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(max_tokens !== undefined ? { max_tokens } : {}),
      ...(top_p !== undefined ? { top_p } : {}),
      ...(frequency_penalty !== undefined ? { frequency_penalty } : {}),
      ...(presence_penalty !== undefined ? { presence_penalty } : {}),
      ...(toolsArray ? { tools: toolsArray } : {}),
      ...(normalizedToolChoice !== undefined
        ? { tool_choice: normalizedToolChoice }
        : {}),
    };

    let requestBody: NormalizedChatCompletionRequest;
    let requestBodyString: string;

      try {
        requestBody = normalizeChatCompletionRequest(requestInput);
        requestBodyString = serializeChatCompletionRequest(requestBody);
      } catch (error) {
        if (error instanceof ZodError) {
          return respondWithChatError(res, 400, "Invalid request body", {
            message: formatZodErrorMessages(error),
          });
        }
        throw error;
      }

    if (shouldLogVerification) {
      logger.debug("[verification] Pre-request:", {
        requestBodyLength: requestBodyString.length,
      });
    }

    // If streaming, use streaming method
    if (stream) {
      let response;
      try {
        response = await client.chatCompletionsStream(requestBody);
      } catch (error) {
        logger.error("NEAR AI Cloud API error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const statusCode =
          error instanceof Error && "statusCode" in error
            ? (error as { statusCode?: number }).statusCode || 500
            : 500;
        return respondWithChatError(res, statusCode, `NEAR AI Cloud API Error: ${statusCode}`, {
          details: errorMessage,
        });
      }

      if (!response.body) {
        return respondWithChatError(res, 500, "Failed to get response stream");
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

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (aborted) break;

          if (value) {
            const chunkText = decoder.decode(value, { stream: true });
            accumulatedResponse += chunkText;
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
          res.write(finalChunk);
        }

        if (!aborted) {
          try {
            const verificationResult = await verifyChatMessage(
              requestBodyString,
              accumulatedResponse,
              model
            );
            if (shouldLogVerification) {
              logger.debug("[verification] Stream verification result:", {
                verificationResult,
              });
            }
          } catch (streamVerificationError) {
            logger.warn(
              "[verification] Stream verification failed:",
              streamVerificationError
            );
          }
        }
      } catch (streamError) {
        if (!aborted) {
          logger.error("Stream error:", streamError);
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
          timeout: parsedBody.data?.timeout,
        });

        const responseText = JSON.stringify(responseData);
        const verificationResult = await verifyChatMessage(
          requestBodyString,
          responseText,
          model
        );

        const payload = responseData as ChatCompletionResponse &
          Record<string, unknown>;
        payload.verification = verificationResult;

        res.status(200).json(payload);
      } catch (error: unknown) {
        logger.error("NEAR AI Cloud API error:", error);

        if (error instanceof NearAITimeoutError) {
          return respondWithChatError(res, 504, "Request timeout", {
            details: error.message,
          });
        }

        if (error instanceof NearAIError) {
          const statusCode = error.statusCode ?? 500;
          return respondWithChatError(
            res,
            statusCode,
            `NEAR AI Cloud API Error: ${statusCode}`,
            { details: error.message }
          );
        }

        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        return respondWithChatError(res, 500, "NEAR AI Cloud API Error", {
          details: message,
        });
      }
    }
  } catch (error: unknown) {
    logger.error("Proxy error:", error);

    // Check if headers already sent
    if (res.headersSent) {
      logger.error("Cannot send error response - headers already sent");
      return;
    }

    // Handle timeout
    if (error instanceof Error && error.name === "AbortError") {
      return respondWithChatError(
        res,
        504,
        "The AI model took too long to respond"
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return respondWithChatError(res, 500, "Failed to proxy request", {
      details: message,
    });
  }
}
