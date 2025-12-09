import { createHash } from "crypto";
import {
  EventType,
  type AGUIEvent,
  type TextMessageContentEvent,
} from "@/types/agui-events";
import { describe, it, expect, vi, afterEach } from "vitest";
import { consumeStream } from "@/server/agent/streaming";
import * as verificationServer from "@/verification/server";

const createMockResponse = (chunks: string[]) => {
  let index = 0;
  const reader = {
    read: async () => {
      if (index < chunks.length) {
        const value = new TextEncoder().encode(chunks[index++]);
        return { value, done: false };
      }
      return { value: undefined, done: true };
    },
  };

  return {
    body: {
      getReader: () => reader,
    },
  } as unknown as Response;
};

describe("consumeStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    verificationServer.clearVerificationSession("session-42");
  });

  it("emits text message events as the SSE stream starts", async () => {
    const events: AGUIEvent[] = [];
    const sseChunks = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n",
      "data: {\"choices\":[{\"finish_reason\":\"stop\",\"delta\":{}}]}\n",
      "data: [DONE]\n",
    ];
    const response = createMockResponse(sseChunks);

    const result = await consumeStream({
      response,
      writeEvent: (event) => events.push(event),
    });

    expect(events.map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
    ]);
    expect(result.content).toBe("Hello world");
    expect(result.finishReason).toBe("stop");
  });

  it("rebuilds split SSE lines coming across multiple reads", async () => {
    const events: AGUIEvent[] = [];
    const response = createMockResponse([
      'data: {"choices":[{"delta":{"content":"Split chunk',
      '"}}]}\n',
      'data: {"choices":[{"delta":{"content":" over reads"}}]}\n',
      "data: [DONE]\n",
    ]);

    const result = await consumeStream({
      response,
      writeEvent: (event) => events.push(event),
    });

    expect(result.content).toBe("Split chunk over reads");
    const contentEvents = events.filter(
      (event) => event.type === EventType.TEXT_MESSAGE_CONTENT
    ) as TextMessageContentEvent[];
    expect(contentEvents.map((event) => event.delta)).toEqual([
      "Split chunk",
      " over reads",
    ]);
  });

  it("cleans up message and tool call events when the stream ends early", async () => {
    const events: AGUIEvent[] = [];
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Interrupted","tool_calls":[{"index":0,"id":"tool-cancel","function":{"name":"search","arguments":"{\\"query\\":\\"NEAR\\"}"}}]}}]}\n',
    ];
    const result = await consumeStream({
      response: createMockResponse(chunks),
      writeEvent: (event) => events.push(event),
      captureToolCalls: true,
    });

    expect(events.some((event) => event.type === EventType.TEXT_MESSAGE_END)).toBe(true);
    expect(
      events.filter((event) => event.type === EventType.TOOL_CALL_END).length
    ).toBe(1);
    expect(result.toolStepStarted).toBe(true);
    expect(result.toolCalls).toEqual([
      {
        id: "tool-cancel",
        type: "function",
        function: {
          name: "search",
          arguments: '{"query":"NEAR"}',
        },
      },
    ]);
  });

  it("handles bursts of SSE data arriving in a single read", async () => {
    const events: AGUIEvent[] = [];
    const combinedChunk =
      'data: {"choices":[{"delta":{"content":"Burst one"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"Burst two"}}]}\n' +
      "data: [DONE]\n";

    await consumeStream({
      response: createMockResponse([combinedChunk]),
      writeEvent: (event) => events.push(event),
    });

    const contentEvents = events.filter(
      (event) => event.type === EventType.TEXT_MESSAGE_CONTENT
    ) as TextMessageContentEvent[];
    expect(contentEvents.map((event) => event.delta)).toEqual([
      "Burst one",
      "Burst two",
    ]);
  });

  it("reports parse errors yet continues processing later chunks", async () => {
    const events: AGUIEvent[] = [];
    const response = createMockResponse([
      'data: {"choices":[{"delta":{"content":"First"}}]}\n',
      "data: {\"choices\":[{\"delta\":{\"content\":\"Broken\"}}\n",
      'data: {"choices":[{"delta":{"content":"Second"}}]}\n',
      "data: [DONE]\n",
    ]);

    const result = await consumeStream({
      response,
      writeEvent: (event) => events.push(event),
    });

    const runErrorEvents = events.filter(
      (event) => event.type === EventType.RUN_ERROR
    );
    expect(runErrorEvents).toHaveLength(1);
    expect(result.content).toBe("FirstSecond");
  });

  it("captures and aggregates tool call streaming data", async () => {
    const events: AGUIEvent[] = [];
    const toolChunks = [
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                content: "Executing tool",
                tool_calls: [
                  {
                    index: 0,
                    id: "tool-call-42",
                    function: {
                      name: "fetch_proposal",
                      arguments: "{\"query\":\"",
                    },
                  },
                ],
              },
            },
          ],
        }) +
        "\n",
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: "NEAR\"}",
                    },
                  },
                ],
              },
            },
          ],
        }) +
        "\n",
      "data: [DONE]\n",
    ];

    const result = await consumeStream({
      response: createMockResponse(toolChunks),
      writeEvent: (event) => events.push(event),
      captureToolCalls: true,
    });

    const toolCallArgs = events.filter(
      (event) => event.type === EventType.TOOL_CALL_ARGS
    );
    expect(toolCallArgs).toHaveLength(2);
    expect(result.toolCalls).toEqual([
      {
        id: "tool-call-42",
        type: "function",
        function: {
          name: "fetch_proposal",
          arguments: '{"query":"NEAR"}',
        },
      },
    ]);
    expect(result.toolStepStarted).toBe(true);
  });

  it("records the SHA-256 hash of the raw SSE payload", async () => {
    const sseChunks = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n",
      "data: {\"choices\":[{\"delta\":{\"finish_reason\":\"stop\"}}]}\n",
      "data: [DONE]\n",
    ];
    const expectedRaw = sseChunks.join("");
    const expectedHash = createHash("sha256").update(expectedRaw).digest("hex");
    const mockResponse = createMockResponse(sseChunks);
    const updateSpy = vi.spyOn(verificationServer, "updateVerificationHashes");
    verificationServer.registerVerificationSession("session-42");

    await consumeStream({
      response: mockResponse,
      writeEvent: vi.fn(),
      sessionVerificationId: "session-42",
    });

    expect(updateSpy).toHaveBeenCalledWith(
      "session-42",
      expect.objectContaining({
        responseHash: expectedHash,
      })
    );
  });
});
