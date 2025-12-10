import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AGENT_MODEL } from "@/server/tools";
import { computeRequestHash } from "@/verification/hashes";
import { performSecondCompletion } from "@/server/agent/verification-flow";

const requestStrings: string[] = [];

vi.mock("@/server/agent/streaming", () => {
  return {
    getStreamingResponse: vi.fn(async (_client, { requestBodyString }) => {
      requestStrings.push(requestBodyString);
      return new Response("data: [DONE]\n\n");
    }),
    consumeStream: vi.fn(async () => ({
      verificationId: "remote-id",
      content: "",
      toolCalls: [],
      finishReason: "stop",
      toolStepStarted: false,
    })),
  };
});

describe("performSecondCompletion hashing", () => {
  beforeEach(() => {
    requestStrings.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the exact serialized request string for hashing and sending", async () => {
    const client = {
      chatCompletionsStream: vi.fn(),
    };

    const requestMessages = [{ role: "user", content: "hi" }];
    const toolCalls = [
      {
        id: "tool_1",
        type: "function",
        function: { name: "do_something", arguments: "{}" },
      },
    ] as any;

    await performSecondCompletion({
      client,
      runtimeBaseUrl: "http://localhost:3000",
      requestMessages,
      toolCalls,
      toolMessages: [],
      writeEvent: vi.fn(),
      baseVerificationId: undefined,
    });

    expect(requestStrings.length).toBe(1);
    const sentString = requestStrings[0];
    const expectedString = JSON.stringify({
      model: AGENT_MODEL,
      messages: [
        ...requestMessages,
        { role: "assistant", content: null, tool_calls: toolCalls },
        ...[],
      ],
      stream: true,
    });
    expect(sentString).toBe(expectedString);
    const recomputed = computeRequestHash(sentString);
    expect(recomputed).toBe(computeRequestHash(expectedString));
  });
});
