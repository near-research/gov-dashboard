import "../../../vi-compat";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MarkdownIt from "markdown-it";
import { fireEvent, render, screen } from "@testing-library/react";

// Capture props passed to VerificationProof to avoid rendering the heavy component.
const verificationProps: any[] = [];

vi.mock("@/components/verification/VerificationProof", () => ({
  VerificationProof: (props: any) => {
    verificationProps.push(props);
    return <div data-testid="verification-proof" />;
  },
}));

vi.mock("@/components/proposal/ProposalCard", () => ({
  default: (props: any) => <div data-testid="proposal-card" {...props} />,
}));

const markdown = new MarkdownIt();
const { ChatInput } = await import("@/components/chat/ChatInput");
const { Message } = await import("@/components/chat/Message");
const { AgentMessage } = await import("@/components/chat/AgentMessage");
const { ChatMessages } = await import("@/components/chat/ChatMessages");

describe("Chat components", () => {
  beforeEach(() => {
    verificationProps.length = 0;
  });

  it("ChatInput sends on enter/click, disables while loading, and handles quick actions", () => {
    const onSend = vi.fn();
    const onClear = vi.fn();

    render(
      <ChatInput
        onSend={onSend}
        onClear={onClear}
        isLoading={false}
        error={null}
        canClear
        quickActions={[{ label: "Hello", message: "hi there" }]}
      />
    );

    const textarea = screen.getByPlaceholderText(/ask me anything/i);
    fireEvent.change(textarea, { target: { value: "question" } });
    fireEvent.keyPress(textarea, { key: "Enter", code: "Enter", charCode: 13 });
    expect(onSend).toHaveBeenCalledWith("question");

    // Should clear and allow click send.
    fireEvent.change(textarea, { target: { value: "next" } });
    const sendButton = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendButton);
    expect(onSend).toHaveBeenCalledWith("next");

    // Clear action available.
    fireEvent.click(screen.getByRole("button", { name: /clear conversation/i }));
    expect(onClear).toHaveBeenCalled();

    // Quick action triggers send.
    fireEvent.click(screen.getByRole("button", { name: /hello/i }));
    expect(onSend).toHaveBeenCalledWith("hi there");
  });

  it("ChatInput disables send/quick actions while loading", () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onClear={() => {}}
        isLoading
        error={null}
        quickActions={[{ label: "Hello", message: "hi there" }]}
      />
    );

    const quick = screen.getByRole("button", { name: /hello/i });
    expect(quick).toBeDisabled();
    const send = screen.getByRole("button", { name: /send/i });
    expect(send).toBeDisabled();
  });

  it("Message renders labels by role and triggers verification proof for assistant", async () => {
    const timestamp = new Date("2024-01-01T00:00:00Z");

    // Assistant path shows "Agent" and proof.
    render(
      <Message
        role="assistant"
        content="**hello**"
        timestamp={timestamp}
        markdown={markdown}
        verification={{ verificationId: "v1" } as any}
        proof={{ verificationId: "v1" } as any}
      />
    );
    expect(screen.getByText(/agent/i)).toBeInTheDocument();
    expect(screen.getByTestId("verification-proof")).toBeInTheDocument();
    expect(verificationProps[0]?.verificationId).toBe("v1");

    // Developer path maps to "Developer".
    render(
      <Message
        role="system"
        rawRole="developer"
        content="note"
        timestamp={timestamp}
        markdown={markdown}
      />
    );
    expect(screen.getByText(/developer/i)).toBeInTheDocument();
  });

  it("AgentMessage shows phase badge and detail", async () => {
    render(
      <AgentMessage agentName="Worker" phase="running" detail="working..." />
    );
    expect(screen.getByText("Worker")).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
    expect(screen.getByText(/working/i)).toBeInTheDocument();
  });

  it("ChatMessages shows welcome, typing indicator, and scroll control", async () => {
    render(
      <ChatMessages
        events={[]}
        isLoading={false}
        isInitialized
        showTypingIndicator
        welcomeMessage="Hi there"
        markdown={markdown}
        isAtBottom={false}
        onNearBottomChange={() => {}}
      />
    );

    expect(screen.getByText(/welcome/i)).toBeInTheDocument();
    expect(screen.getByText(/hi there/i)).toBeInTheDocument();
    expect(screen.getByTestId("scroll-to-bottom")).not.toBeNull();
  });

  it("ChatMessages renders messages and typing indicator when busy", async () => {
    const events = [
      {
        kind: "message",
        id: "m1",
        role: "assistant",
        content: "Hi",
        status: "completed",
        timestamp: new Date(),
        turnNumber: 1,
      },
    ];

    render(
      <ChatMessages
        events={events as any}
        isLoading={true}
        isInitialized
        showTypingIndicator
        welcomeMessage="Hi there"
        markdown={markdown}
        isAtBottom={false}
        onNearBottomChange={() => {}}
      />
    );

    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(document.querySelectorAll(".animate-bounce").length).toBeGreaterThan(
      0
    );
  });

  it("ChatMessages keeps streaming assistant updates appended instead of replacing earlier content", () => {
    const events = [
      {
        kind: "message",
        id: "u1",
        role: "user",
        content: "Question",
        status: "completed",
        timestamp: new Date(),
        turnNumber: 1,
      },
      {
        kind: "message",
        id: "a1",
        role: "assistant",
        content: "Thinking...",
        status: "in_progress",
        timestamp: new Date(),
        turnNumber: 1,
      },
      {
        kind: "message",
        id: "a2",
        role: "assistant",
        content: "Final answer",
        status: "completed",
        timestamp: new Date(),
        turnNumber: 1,
      },
    ];

    render(
      <ChatMessages
        events={events as any}
        isLoading={false}
        isInitialized
        showTypingIndicator={false}
        welcomeMessage="Hi there"
        markdown={markdown}
        isAtBottom={true}
        onNearBottomChange={() => {}}
      />
    );

    const partial = screen.getByText("Thinking...");
    const final = screen.getByText("Final answer");
    expect(partial).toBeInTheDocument();
    expect(final).toBeInTheDocument();
    expect(
      (partial.compareDocumentPosition(final) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ).toBe(true);
  });

  it("ChatMessages updates near-bottom tracking and shows scroll control when not anchored", () => {
    const events = [
      {
        kind: "message",
        id: "m1",
        role: "assistant",
        content: "Line 1",
        status: "completed",
        timestamp: new Date(),
        turnNumber: 1,
      },
    ];
    const onNearBottomChange = vi.fn();

    const { container } = render(
      <ChatMessages
        events={events as any}
        isLoading={false}
        isInitialized
        showTypingIndicator={false}
        welcomeMessage="Hi there"
        markdown={markdown}
        isAtBottom={false}
        onNearBottomChange={onNearBottomChange}
      />
    );

    const scroller = container.querySelector(".overflow-y-scroll") as HTMLDivElement;
    Object.defineProperty(scroller, "scrollHeight", { value: 500, writable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 100, writable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });

    scroller.dispatchEvent(new Event("scroll"));

    expect(onNearBottomChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("scroll-to-bottom")).toBeInTheDocument();
  });

  it("ChatMessages shows typing indicator only when enabled", () => {
    const events = [
      {
        kind: "message",
        id: "m1",
        role: "assistant",
        content: "Hi",
        status: "completed",
        timestamp: new Date(),
        turnNumber: 1,
      },
    ];

    render(
      <ChatMessages
        events={events as any}
        isLoading={false}
        isInitialized
        showTypingIndicator={false}
        welcomeMessage="Hi there"
        markdown={markdown}
        isAtBottom={true}
        onNearBottomChange={() => {}}
      />
    );

    expect(document.querySelectorAll(".animate-bounce")).toHaveLength(0);
  });
});
