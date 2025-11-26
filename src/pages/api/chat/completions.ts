import type { NextApiRequest, NextApiResponse } from "next";
import {
  extractVerificationMetadata,
  normalizeVerificationPayload,
} from "@/utils/verification";
import { createHash } from "crypto";
import { registerVerificationSession, updateVerificationHashes } from "@/server/verificationSessions";
import { getNearAIClient } from "@/lib/near-ai/client";
import type { ChatCompletionRequest } from "@/lib/near-ai/types";

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
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: unknown;
  tool_choice?: unknown;
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
    return res.status(405).json({ error: "Method not allowed" });
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
  } = req.body;

  // Validate required fields
  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: "Invalid request body",
      message: "Required fields: model (string), messages (array)",
    });
  }

  // Validate messages format
  for (const msg of messages) {
    if (!msg.role || (msg.content === undefined && !msg.tool_calls)) {
      return res.status(400).json({
        error: "Invalid message format",
        message:
          "Each message must have 'role' and 'content' fields (or 'tool_calls' for assistant)",
      });
    }
  }

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
    if (tool_choice !== undefined) requestBody.tool_choice = tool_choice;

    // Hash body BEFORE adding verification (headers carry verification)
    const requestBodyString = JSON.stringify(requestBody);
    const requestHash = createHash("sha256").update(requestBodyString).digest("hex");

    const localVerificationData =
      verificationId && verificationNonce
        ? { id: verificationId, nonce: verificationNonce }
        : undefined;

    console.log("[verification] Pre-request:", {
      verificationId: verificationId || null,
      nonce: verificationNonce || null,
      requestHash,
      requestBodyLength: requestBodyString.length,
      requestBodyPreview: requestBodyString.substring(0, 100),
    });

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
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const statusCode = error instanceof Error && "statusCode" in error
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

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let rawResponseBuffer = "";

      // Pre-register session with provided verificationId/nonce and requestHash
      if (verificationId) {
        registerVerificationSession(
          verificationId,
          verificationNonce,
          requestHash,
          null
        );
      }

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            rawResponseBuffer += chunk;
            // Write exact bytes without modification
            res.write(chunk);
          }

          if (done) break;
        }

        const finalChunk = decoder.decode();
        if (finalChunk) {
          rawResponseBuffer += finalChunk;
          res.write(finalChunk);
        }

        if (verificationId) {
          console.log("[verification] Stream complete:", {
            verificationId,
            rawResponseLength: rawResponseBuffer.length,
            endsWithNewlines: rawResponseBuffer.endsWith("\n\n"),
          });
        }
      } catch (streamError) {
        console.error("Stream error:", streamError);
      } finally {
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    } else {
      // Non-streaming response
      let data;
      try {
        data = await client.chatCompletions(requestBody, {
          verificationId,
          verificationNonce,
        });
      } catch (error) {
        console.error("NEAR AI Cloud API error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const statusCode = error instanceof Error && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode || 500
          : 500;
        return res.status(statusCode).json({
          error: `NEAR AI Cloud API Error: ${statusCode}`,
          details: errorMessage,
        });
      }

      const responseText = JSON.stringify(data);
      const responseHash = createHash("sha256").update(responseText).digest("hex");
      const rawVerification = extractVerificationMetadata(data);
      const { verification, verificationId: normalizedVerificationId } = normalizeVerificationPayload(
        rawVerification,
        data?.id
      );
      if (verification) {
        (data as any).verification = verification;
      }
      if (normalizedVerificationId) {
        (data as any).verificationId = normalizedVerificationId;
        registerVerificationSession(normalizedVerificationId, undefined, requestHash, responseHash);
      }
      res.status(200).json(data);
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
