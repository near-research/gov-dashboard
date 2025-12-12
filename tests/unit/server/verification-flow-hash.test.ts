import { describe, it, expect } from "vitest";
import { AGENT_MODEL } from "@/server/tools";
import { computeRequestHash } from "@/verification/hashes";
import { buildCompletionRequest } from "@/server/agent/verification-flow";

describe("completion request hashing", () => {
  it("serializes the completion payload consistently and hashes it", () => {
    const requestMessages = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
    ];
    const toolCalls = [
      {
        id: "tool-1",
        type: "function",
        function: { name: "mock_tool", arguments: "{}" },
      },
    ];

    const completion = buildCompletionRequest({
      model: AGENT_MODEL,
      messages: [
        ...requestMessages,
        { role: "assistant", content: null, tool_calls: toolCalls },
      ],
      tools: [{ name: "mock_tool" }],
      toolChoice: "auto",
    });

    const expectedBody = {
      model: AGENT_MODEL,
      messages: [
        ...requestMessages,
        { role: "assistant", content: null, tool_calls: toolCalls },
      ],
      tools: [{ name: "mock_tool" }],
      tool_choice: "auto",
      stream: true,
    };

    const parsed = JSON.parse(completion.requestBodyString);
    expect(parsed).toEqual(expectedBody);
    expect(completion.requestHash).toBe(
      computeRequestHash(completion.requestBodyString)
    );
  });
});
