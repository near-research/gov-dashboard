import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { Chat } from "@/components/chat/Chat";
import { EventType } from "@/types/agui-events";
import { toast } from "sonner";

vi.mock("@/lib/analytics", () => ({
  useGovernanceAnalytics: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const SESSION_STORAGE_KEY = "agent_chat_session_v1";

const hydrateSessionWithEvents = (events: Array<Record<string, unknown>>) => {
  const serialized = JSON.stringify({
    events: events.map((event) => {
      const timestamp =
        event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : event.timestamp;
      return {
        ...event,
        timestamp,
      };
    }),
  });
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, serialized);
};

describe("Chat", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("shows the welcome placeholder when no history exists", async () => {
    render(
      <Chat
        welcomeMessage="Custom welcome text"
        placeholder="Ask the agent…"
      />
    );

    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Custom welcome text")).toBeInTheDocument();
  });

  it("displays retry controls when the stream aborts mid-response", async () => {
    const readError = new Error("Stream aborted");
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
    };

    const fetchMock = vi.fn((url) => {
      if (
        typeof url === "string" &&
        url.includes("/api/verification/register-session")
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

    vi.stubGlobal("fetch", fetchMock);

    render(<Chat placeholder="Ask the agent…" />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "Stream test" } });

    const sendButton = screen.getByLabelText("Send message");
    fireEvent.click(sendButton);

    await screen.findByText("Run interrupted");
    expect(screen.getByRole("button", { name: /^Retry$/i })).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Agent error", {
      description: "Stream aborted",
    });
  });

  it("hydrates the timeline and surfaces agent/tool metadata", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    hydrateSessionWithEvents([
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

    render(<Chat model="Test-AI/1.0" placeholder="Ask the agent…" />);

    expect(
      await screen.findByText("Initial answer from agent")
    ).toBeInTheDocument();

    expect(screen.getByText("Agent")).toBeInTheDocument();

    expect(screen.getByText("Tools Used")).toBeInTheDocument();
    expect(screen.getByText("Discourse Fetch")).toBeInTheDocument();
    expect(screen.getAllByText(/\d{1,2}:\d{2}/).length).toBeGreaterThan(0);

    const showButton = screen.getByRole("button", { name: /^Show$/i });
    fireEvent.click(showButton);

    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("toggles the loading indicator while sending and shows error states when the run fails", async () => {
    const fetchMock = vi.fn((url) => {
      if (
        typeof url === "string" &&
        url.includes("/api/verification/register-session")
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ nonce: "mock-nonce" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      if (typeof url === "string" && url.includes("/api/agent")) {
        return Promise.reject(new Error("Agent boom"));
      }

      return Promise.reject(new Error("unexpected fetch"));
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<Chat placeholder="Ask the agent…" />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "What is NEAR?" } });

    const sendButton = screen.getByLabelText("Send message");
    fireEvent.click(sendButton);

    expect(sendButton).toBeDisabled();
    expect(sendButton.querySelector(".animate-spin")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(sendButton.querySelector(".animate-spin")).not.toBeInTheDocument();
    });

    const errorNodes = await screen.findAllByText(/Agent boom/);
    expect(errorNodes.length).toBeGreaterThanOrEqual(1);
    expect(toast.error).toHaveBeenCalledWith("Agent error", {
      description: "Agent boom",
    });
  });
});
