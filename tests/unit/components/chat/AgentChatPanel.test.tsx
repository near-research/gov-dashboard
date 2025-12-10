import "../../../vi-compat";
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentChatPanel } from "@/components/chat/AgentChatPanel";
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

type VerificationAuthTokenFn = typeof import("@/lib/verification/near-ai")["createVerificationAuthToken"];
const walletSignerMock = { signMessage: vi.fn() };
const createAuthTokenMock = vi.fn<VerificationAuthTokenFn>(async () => "proof-token");
vi.mock("@/hooks/useNear", () => ({
  useNear: () => ({
    walletSigner: walletSignerMock,
    signedAccountId: "test.near",
  }),
}));
vi.mock("@/lib/verification/near-ai", () => ({
  createVerificationAuthToken: (...args: Parameters<VerificationAuthTokenFn>) =>
    createAuthTokenMock(...args),
}));

const createStreamingReader = (chunks: string[]) => {
  const encoder = new TextEncoder();
  let readCount = 0;
  return {
    read: vi.fn(async () => {
      if (readCount < chunks.length) {
        const value = encoder.encode(chunks[readCount]);
        readCount += 1;
        return {
          done: false,
          value,
        };
      }
      return {
        done: true,
        value: undefined,
      };
    }),
  };
};

const stubStreamingFetch = (
  reader: ReturnType<typeof createStreamingReader>
) => {
  const verificationResponse = new Response(
    JSON.stringify({ nonce: "stream-nonce" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );

  const agentResponse = {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      getReader: () => reader,
    },
  } as unknown as Response;

  const fetchMock = vi.fn((input: RequestInfo) => {
    if (
      typeof input === "string" &&
      input.includes("/api/verification/register-session")
    ) {
      return Promise.resolve(verificationResponse);
    }
    if (typeof input === "string" && input.includes("/api/agent")) {
      return Promise.resolve(agentResponse);
    }
    return Promise.reject(new Error("unexpected fetch"));
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("AgentChatPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    walletSignerMock.signMessage.mockReset();
    createAuthTokenMock.mockReset();
    createAuthTokenMock.mockResolvedValue("proof-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the welcome placeholder when no history is present", async () => {
    render(<AgentChatPanel />);

    expect(
      await screen.findByText(/Welcome to the NEAR AI proposal agent\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Ask me anything about NEAR proposals/i)
    ).toBeInTheDocument();
  });

  it("disables the send control while awaiting the streaming response", async () => {
    const fetchMock = vi.fn();
    let resolveAgentResponse!: (value: Response) => void;
    const agentPromise = new Promise<Response>((resolve) => {
      resolveAgentResponse = resolve;
    });

    fetchMock.mockImplementation((input) => {
      if (
        typeof input === "string" &&
        input.includes("/api/verification/register-session")
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ nonce: "stream-nonce" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (typeof input === "string" && input.includes("/api/agent")) {
        return agentPromise;
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<AgentChatPanel />);
    const textarea = await screen.findByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    const sendButton = screen.getByRole("button", { name: /Send message/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(sendButton.querySelector("svg.animate-spin")).toBeInTheDocument();
      expect(sendButton).toBeDisabled();
    });

    resolveAgentResponse({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    } as Response);

    await waitFor(() => {
      expect(sendButton.querySelector("svg.animate-spin")).toBeNull();
    });
  });

  it("displays an error banner when the agent call fails", async () => {
    const fetchMock = vi.fn((input) => {
      if (
        typeof input === "string" &&
        input.includes("/api/verification/register-session")
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ nonce: "error-nonce" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (typeof input === "string" && input.includes("/api/agent")) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<AgentChatPanel />);
    const textarea = await screen.findByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "Fail me" } });
    fireEvent.click(screen.getByRole("button", { name: /Send message/i }));

    expect(await screen.findByText(/Run interrupted/)).toBeInTheDocument();
    expect(screen.getAllByText("boom")[0]).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Agent error", {
      description: "boom",
    });
  });

  it("renders the assistant reply after streaming SSE chunks that reconnect mid-payload", async () => {
    const chunk = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
    const firstPiece = chunk({
      type: EventType.TEXT_MESSAGE_CONTENT,
      delta: "Hello",
    });
    const secondPiece = chunk({
      type: EventType.TEXT_MESSAGE_CONTENT,
      delta: " world",
    });
    const completionChunk = chunk({ type: EventType.TEXT_MESSAGE_END });

    const reader = createStreamingReader([
      firstPiece.slice(0, -2),
      `${firstPiece.slice(-2)}${secondPiece}${completionChunk}`,
    ]);

    stubStreamingFetch(reader);

    render(<AgentChatPanel />);
    const textarea = await screen.findByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "Echo" } });
    fireEvent.click(screen.getByRole("button", { name: /Send message/i }));

    await waitFor(() => {
      expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
    });

    expect(await screen.findByText(/Hello world/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId("typing-indicator")).toBeNull();
      expect(textarea).not.toBeDisabled();
      expect(textarea).toHaveValue("");
    });
  });

  it("returns the welcome card and surfaces errors when a RUN_ERROR event is streamed", async () => {
    const reader = createStreamingReader([
      `data: ${JSON.stringify({
        type: EventType.RUN_ERROR,
        message: "Agent crashed unexpectedly",
      })}\n\n`,
    ]);

    stubStreamingFetch(reader);

    render(<AgentChatPanel />);
    const textarea = await screen.findByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "Broken" } });
    fireEvent.click(screen.getByRole("button", { name: /Send message/i }));

    expect(
      await screen.findByText(/Run interrupted/i)
    ).toBeInTheDocument();
    const errorMessages = await screen.findAllByText(
      /Agent crashed unexpectedly/i
    );
    expect(errorMessages.length).toBeGreaterThan(0);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Agent crashed unexpectedly/i);
    expect(textarea).not.toBeDisabled();
  });
});
