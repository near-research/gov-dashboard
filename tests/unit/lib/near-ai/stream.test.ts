import { describe, expect, it, vi } from "vitest";
import { streamChatCompletion } from "@/lib/near-ai/stream";
import type { ChatCompletionRequest } from "@/lib/near-ai/types";
import type { NearAIClient } from "@/lib/near-ai/client";

const createMockReadableStream = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      } else {
        controller.close();
      }
    },
  });
};

const mockClientWithChunks = (chunks: string[]): NearAIClient =>
  ({
    chatCompletionsStream: vi
      .fn()
      .mockResolvedValue(new Response(createMockReadableStream(chunks))),
  } as unknown as NearAIClient);

describe("streamChatCompletion", () => {
  it("accumulates partial SSE chunks and returns the combined summary", async () => {
    const chunks = [
      'data: {"id":"chat-42","choices":[{"delta":{"content":"Hel',
      'lo"}}]}\n',
      "\ndata: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n",
      "data: \n\n",
      "data: [DONE]\n\n",
    ];

    const client = mockClientWithChunks(chunks);
    const result = await streamChatCompletion(
      client,
      {} as ChatCompletionRequest
    );

    expect(result.summary).toBe("Hello world");
    expect(result.chatId).toBe("chat-42");
    expect(result.responseText).toBe(chunks.join(""));
  });

  it("recovers from malformed JSON without dropping subsequent chunks", async () => {
    const chunks = [
      "data: {not-json}\n\n",
      'data: {"choices":[{"delta":{"content":"Recovery"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const client = mockClientWithChunks(chunks);
    const result = await streamChatCompletion(
      client,
      {} as ChatCompletionRequest
    );

    expect(result.summary).toBe("Recovery");
  });

  it("handles delta-only SSE events", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Message only"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const client = mockClientWithChunks(chunks);
    const result = await streamChatCompletion(
      client,
      {} as ChatCompletionRequest
    );

    expect(result.summary).toBe("Message only");
  });

  it("throws when the stream response provides no body", async () => {
    const client = {
      chatCompletionsStream: vi.fn().mockResolvedValue({
        body: null,
      } as Response),
    } as unknown as NearAIClient;

    await expect(
      streamChatCompletion(client, {} as ChatCompletionRequest)
    ).rejects.toThrow("NEAR AI stream response body is empty");
  });

  it("handles multiple SSE events and ignores verification-only chunks", async () => {
    const streamText = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: {"verification":{"status":"failed"}}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    const client = mockClientWithChunks([streamText]);
    const result = await streamChatCompletion(
      client,
      {} as ChatCompletionRequest
    );

    expect(result.summary).toBe("Hello world");
    expect(result.responseText).toBe(streamText);
  });

  it("handles streams where chunks arrive back-to-back without blank lines", async () => {
    const streamText = [
      'data: {"choices":[{"delta":{"content":"Packed"}}]}',
      'data: {"verification":{"status":"failed"}}',
      "data: [DONE]",
    ].join("\n");
    const client = mockClientWithChunks([streamText]);
    const result = await streamChatCompletion(
      client,
      {} as ChatCompletionRequest
    );

    expect(result.summary).toBe("Packed");
  });
});
