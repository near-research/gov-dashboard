import type { ChatCompletionRequest, ChatCompletionOptions } from "@/types/near-ai";
import { extractChatId } from "@/lib/verification";
import { NearAIClient } from "./client";

export interface StreamChatResult {
  chatId: string | null;
  responseText: string;
  summary: string;
}

const parseStreamedSummary = (streamText: string): string => {
  const lines = streamText.split(/\r?\n/);
  let content = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const chunk = JSON.parse(payload);
      const choice = chunk?.choices?.[0];
      if (!choice) continue;

      const deltaContent =
        typeof choice.delta?.content === "string"
          ? choice.delta.content
          : "";
      if (deltaContent) {
        content += deltaContent;
        continue;
      }

      const messageContent =
        typeof choice.message?.content === "string"
          ? choice.message.content
          : "";
      if (messageContent) {
        content += messageContent;
      }
    } catch {
      // ignore malformed chunks
    }
  }

  return content;
};

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
  const summary = parseStreamedSummary(responseText);
  const chatId = extractChatId(responseText);

  return { summary, chatId, responseText };
};
