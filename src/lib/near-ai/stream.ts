import type {
  ChatCompletionRequest,
  ChatCompletionOptions,
} from "./types";
import { extractChatId } from "./verification";
import { NearAIClient } from "./client";

export interface StreamChatResult {
  chatId: string | null;
  responseText: string;
  summary: string;
}

export function parseStreamedSummary(text: string): {
  summary: string;
  chatId: string | null;
  responseText: string;
} {
  console.log("[DEBUG] [parseStreamedSummary] Input length:", text.length);

  let summary = "";
  let chatId: string | null = null;

  const events = text.split("\n\n");

  for (const event of events) {
    if (!event.trim()) continue;

    const lines = event.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;

      const data = line.slice(6);

      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);

        if (parsed.verification && !parsed.choices) continue;

        if (parsed.id && !chatId) {
          chatId = parsed.id;
        }

        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          summary += content;
          console.log(
            "[DEBUG] [parseStreamedSummary] Added content:",
            content.substring(0, 30)
          );
        }
      } catch {
        console.log(
          "[DEBUG] [parseStreamedSummary] Failed to parse:",
          data.substring(0, 50)
        );
      }
    }
  }

  console.log(
    "[DEBUG] [parseStreamedSummary] Final summary length:",
    summary.length
  );
  console.log(
    "[DEBUG] [parseStreamedSummary] Final summary preview:",
    summary.substring(0, 100)
  );

  return { summary, chatId, responseText: text };
}

const readStreamToString = async (
  stream: ReadableStream<Uint8Array>
): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }
    }

    const finalChunk = decoder.decode();
    if (finalChunk) {
      buffer += finalChunk;
    }

    return buffer;
  } finally {
    reader.releaseLock();
  }
};

export const streamChatCompletion = async (
  client: NearAIClient,
  request: ChatCompletionRequest,
  options?: ChatCompletionOptions
): Promise<StreamChatResult> => {
  const response = await client.chatCompletionsStream(request, options);

  if (!response.body) {
    throw new Error("NEAR AI stream response body is empty");
  }

  const responseText = await readStreamToString(response.body);
  const { summary, chatId: parsedChatId } = parseStreamedSummary(responseText);
  const chatId = parsedChatId ?? extractChatId(responseText);

  return { summary, chatId, responseText };
};
