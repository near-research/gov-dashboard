import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { Chat } from "@/components/chat/Chat";
import { EventType } from "@/types/agui-events";
import type { AgentUIEvent, ToolCallUIEvent } from "@/types/agent-ui";
import type { ReadonlyJSONObject } from "assistant-stream/utils";
import type {
  ThreadAssistantMessagePart,
  ThreadMessage,
  ThreadUserMessagePart,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import { setTestFetchHandler } from "../../../utils/fetch";
import { createSessionHistoryAdapter } from "@/lib/history-adapter";
import { toast } from "sonner";

vi.mock("@/lib/analytics", () => ({
  useGovernanceAnalytics: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const SESSION_STORAGE_KEY = "gov_chat_history_v1";
const expectedUnhandledRejectionMessages: string[] = [];
const caughtUnhandledRejectionMessages: string[] = [];
const handleUnhandledRejection = (reason: unknown) => {
  const message =
    reason instanceof Error ? reason.message : String(reason ?? "unknown");
  if (expectedUnhandledRejectionMessages.includes(message)) {
    caughtUnhandledRejectionMessages.push(message);
    return;
  }
  throw reason;
};

const parseJsonSafe = (value?: string | null): unknown => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

type ThreadStep = {
  readonly messageId?: string;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
};

const buildThreadMessage = (
  event: Extract<AgentUIEvent, { kind: "message" }>,
  toolEvents: ToolCallUIEvent[] | undefined
): ThreadMessage => {
  const timestamp =
    event.timestamp instanceof Date
      ? event.timestamp
      : new Date(event.timestamp as string | number);

  if (event.role === "assistant") {
    const assistantContent: ThreadAssistantMessagePart[] = [
      {
        type: "text",
        text: event.content,
      },
    ];
    if (toolEvents?.length) {
      for (const toolEvent of toolEvents) {
        const toolCallPart: ToolCallMessagePart = {
          type: "tool-call",
          toolCallId: toolEvent.toolCallId,
          toolName: toolEvent.toolName,
          args: parseJsonSafe(toolEvent.input) as ReadonlyJSONObject,
          argsText: toolEvent.input ?? "",
          result: parseJsonSafe(toolEvent.output),
          isError: false,
        };

        assistantContent.push(toolCallPart);
      }
    }

    return {
      id: event.id,
      createdAt: timestamp,
      role: "assistant",
      content: assistantContent,
      status: { type: "complete", reason: "unknown" } as const,
      metadata: {
        unstable_state: {} as const,
        unstable_annotations: [] as const,
        unstable_data: [] as const,
        steps: [] as ThreadStep[],
        custom: {} as Record<string, unknown>,
      },
    };
  }

  const userContent: ThreadUserMessagePart[] = [
    {
      type: "text",
      text: event.content,
    },
  ];

  return {
    id: event.id,
    createdAt: timestamp,
    role: "user",
    content: userContent,
    attachments: [] as const,
    metadata: {
      custom: {} as Record<string, unknown>,
    },
  };
};

const hydrateSessionWithEvents = async (events: AgentUIEvent[]) => {
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  const historyAdapter = createSessionHistoryAdapter();
  const toolCallsByTurn = new Map<number, ToolCallUIEvent[]>();
  for (const event of events) {
    if (event.kind === "tool_call") {
      const bucket = toolCallsByTurn.get(event.turnNumber) ?? [];
      bucket.push(event);
      toolCallsByTurn.set(event.turnNumber, bucket);
    }
  }

  let previousMessageId: string | null = null;
  for (const event of events) {
    if (event.kind !== "message") {
      continue;
    }
    const toolEvents = toolCallsByTurn.get(event.turnNumber);
    const message = buildThreadMessage(event, toolEvents);
    await historyAdapter.append({
      message,
      parentId: previousMessageId,
    });
    previousMessageId = message.id;
  }
};

describe("Chat", () => {
  beforeAll(() => {
    if (!("scrollTo" in HTMLDivElement.prototype)) {
      Object.defineProperty(HTMLDivElement.prototype, "scrollTo", {
        value() {},
        writable: true,
      });
    }
  });

  beforeEach(() => {
    expectedUnhandledRejectionMessages.length = 0;
    caughtUnhandledRejectionMessages.length = 0;
    process.on("unhandledRejection", handleUnhandledRejection);
    window.sessionStorage.clear();
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.off("unhandledRejection", handleUnhandledRejection);
    expect(caughtUnhandledRejectionMessages.sort()).toEqual(
      expectedUnhandledRejectionMessages.sort()
    );
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  const expectUnhandledRejection = (message: string) => {
    expectedUnhandledRejectionMessages.push(message);
  };

  it("displays retry controls when the stream aborts mid-response", async () => {
    const readError = new Error("Stream aborted");
    expectUnhandledRejection(readError.message);
    let readCalls = 0;
    const reader = {
      read: vi.fn(async () => {
        readCalls += 1;
        if (readCalls === 1) {
          return {
            done: false,
            value: new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: EventType.TEXT_MESSAGE_CONTENT,
                delta: "partial answer",
              })}\n\n`
            ),
          };
        }
        throw readError;
      }),
      releaseLock: vi.fn(),
    };

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (
        typeof url === "string" &&
        url.includes("/api/verification/session")
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ nonce: "mock-nonce" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (typeof url === "string" && url.includes("/api/agent")) {
        return Promise.resolve({
          ok: true,
          body: {
            getReader: () => reader,
          },
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });
    setTestFetchHandler(fetchMock);

    render(<Chat placeholder="Ask the agent…" />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "Stream test" } });

    const sendButton = screen.getByLabelText("Send message");
    fireEvent.click(sendButton);

    await screen.findByText("Verification Failed");
    await screen.findByText("Stream aborted");
    const errorBanner = screen.getByRole("button", {
      name: /Verification Failed/i,
    });
    expect(errorBanner).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Agent Error", {
      description: "Stream aborted",
    });
  });

  it("hydrates the timeline and surfaces agent/tool metadata", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    await hydrateSessionWithEvents([
      {
        id: "user-1",
        kind: "message",
        role: "user",
        content: "Initial question",
        status: "completed",
        timestamp: baseTime,
        turnNumber: 1,
      },
      {
        id: "agent-1",
        kind: "message",
        role: "assistant",
        content: "Initial answer from agent",
        status: "completed",
        timestamp: new Date(baseTime.getTime() + 1_000),
        turnNumber: 1,
        messageId: "msg-agent-1",
        verification: { source: "near-ai-cloud", status: "pending" },
        proof: {
          stage: "initial_reasoning",
          verificationId: "verif-1",
          requestHash: "req-hash",
          responseHash: "res-hash",
        },
      },
      {
        id: "tool-1",
        kind: "tool_call",
        toolCallId: "tool-1",
        toolName: "Discourse Fetch",
        status: "completed",
        turnNumber: 1,
        timestamp: new Date(baseTime.getTime() + 2_000),
        input: JSON.stringify({ query: "governance" }),
        output: JSON.stringify({ hits: [] }),
      },
    ]);

    const fetchMock = vi.fn((url: string) => {
      if (
        typeof url === "string" &&
        url.includes("/api/verification/session")
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ nonce: "mock-nonce" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      if (typeof url === "string" && url.includes("/api/agent")) {
        return Promise.resolve(
          new Response(null, {
            status: 204,
          })
        );
      }

      return Promise.reject(new Error("unexpected fetch"));
    });
    setTestFetchHandler(fetchMock);

    render(<Chat model="Test-AI/1.0" placeholder="Ask the agent…" />);

    const storedRaw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    expect(storedRaw).toBeTruthy();
    const stored = JSON.parse(storedRaw!);
    expect(stored.messages).toHaveLength(2);

    const assistantEntry = stored.messages.find(
      (entry: any) => entry.message.role === "assistant"
    );
    expect(assistantEntry).toBeDefined();
    const toolCallPart = assistantEntry.message.content.find(
      (part: any) => part.type === "tool-call"
    );
    expect(toolCallPart).toBeDefined();
    expect(toolCallPart.toolName).toBe("Discourse Fetch");
  });

  it("toggles the loading indicator while sending and shows error states when the run fails", async () => {
    const errorReader = {
      read: vi.fn(async () => {
        throw new Error("Agent boom");
      }),
      releaseLock: vi.fn(),
    };
    expectUnhandledRejection("Agent boom");

    const fetchMock = vi.fn((url: string) => {
      if (
        typeof url === "string" &&
        url.includes("/api/verification/session")
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ nonce: "mock-nonce" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      if (typeof url === "string" && url.includes("/api/agent")) {
        return Promise.resolve({
          ok: true,
          body: {
            getReader: () => errorReader,
          },
        });
      }

      return Promise.reject(new Error("unexpected fetch"));
    });
    setTestFetchHandler(fetchMock);

    render(<Chat placeholder="Ask the agent…" />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "What is NEAR?" } });

    const sendButton = screen.getByLabelText("Send message");
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(sendButton).toBeDisabled();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(sendButton.querySelector(".animate-spin")).not.toBeInTheDocument();
    });

    const errorNodes = await screen.findAllByText(/Agent boom/);
    expect(errorNodes.length).toBeGreaterThanOrEqual(1);
    expect(toast.error).toHaveBeenCalledWith("Agent Error", {
      description: "Agent boom",
    });
  });
});
