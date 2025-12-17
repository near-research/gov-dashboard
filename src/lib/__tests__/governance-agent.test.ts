import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { createGovernanceAgent } from "@/lib/governance-agent";
import type { RunAgentInput } from "@ag-ui/client";
import { EventType } from "@/types/agui-events";

const originalFetch = global.fetch;

describe("createGovernanceAgent", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("parses SSE events correctly", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: EventType.TEXT_MESSAGE_START,
              messageId: "msg-1",
            })}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId: "msg-1",
              delta: "hello",
            })}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: EventType.RUN_FINISHED })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const agent = createGovernanceAgent({ agentId: "test-agent" });
    const subscriber = {
      onTextMessageStartEvent: vi.fn(),
      onTextMessageContentEvent: vi.fn(),
      onRunFinishedEvent: vi.fn(),
    };

    await agent.runAgent(
      { messages: [{ id: "user-1", role: "user", content: "hi" }] } as RunAgentInput,
      subscriber
    );

    expect(subscriber.onTextMessageStartEvent).toHaveBeenCalledTimes(1);
    expect(subscriber.onTextMessageContentEvent).toHaveBeenCalledTimes(1);
    expect(subscriber.onRunFinishedEvent).toHaveBeenCalledTimes(1);
  });

  it("calls onVerification for VERIFICATION events", async () => {
    const encoder = new TextEncoder();
    const verificationEvent = {
      type: EventType.VERIFICATION,
      verification: {
        source: "near-ai-cloud",
        status: "verified",
      },
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(verificationEvent)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    (global.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ verificationId: "verif", nonce: "nonce" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      });

    const onVerification = vi.fn();
    const agent = createGovernanceAgent({ agentId: "test-agent", onVerification });

    await agent.runAgent(
      { messages: [{ id: "user-2", role: "user", content: "hi" }] } as RunAgentInput,
      {}
    );

    expect(onVerification).toHaveBeenCalledWith(verificationEvent.verification);
  });

  it("handles abort signal", async () => {
    const abortController = new AbortController();
    (global.fetch as Mock).mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener?.("abort", () => {
            reject(new Error("aborted"));
          }, { once: true });
        })
    );

    const agent = createGovernanceAgent({ agentId: "test-agent" });
    setTimeout(() => abortController.abort(), 0);

    await expect(
      agent.runAgent(
        { messages: [{ id: "user-3", role: "user", content: "hi" }] } as RunAgentInput,
        {},
        { signal: abortController.signal }
      )
    ).rejects.toThrow("aborted");
  });
});
