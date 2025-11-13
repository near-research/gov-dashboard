"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { applyPatch, type Operation } from "fast-json-patch";
import MarkdownIt from "markdown-it";
import {
  EventType,
  type AGUIEvent,
  type MessageRole,
  type MessagesSnapshotEvent,
  type StateDeltaEvent,
  type StateSnapshotEvent,
} from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";
import { SidebarChat } from "@/components/editor/SidebarChat";
import { EditorPane } from "@/components/editor/EditorPane";
import { EvaluationSummary } from "@/components/editor/EvaluationSummary";
import { diffPartialText } from "@/utils/diff";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
}

interface ProposalState {
  title: string;
  content: string;
  evaluation: Evaluation | null;
}

interface ToolCallState {
  id: string;
  name: string;
  args: string;
  status: "in_progress" | "completed";
}

export default function ProposalEditor() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);

  // 👇 view mode toggle
  const [viewMode, setViewMode] = useState<"editor" | "preview">("editor");
  const [showDiffHighlights, setShowDiffHighlights] = useState(false);

  // agent state
  const [proposalState, setProposalState] = useState<ProposalState>({
    title: "",
    content: "",
    evaluation: null,
  });

  // local editable state
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");

  // snapshot for diff / modal
  const [snapshotTitle, setSnapshotTitle] = useState("");
  const [snapshotContent, setSnapshotContent] = useState("");

  // diff HTML for preview
  const [contentDiffHtml, setContentDiffHtml] = useState("");

  // pending AI changes
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [pendingTitle, setPendingTitle] = useState("");
  const [pendingContent, setPendingContent] = useState("");

  // streaming stuff
  const [currentMessage, setCurrentMessage] = useState<{
    id: string;
    content: string;
  } | null>(null);

  const [activeToolCalls, setActiveToolCalls] = useState<
    Map<string, ToolCallState>
  >(new Map());

  // Store completed tool calls for TOOL_CALL_RESULT lookup
  const completedToolCallsRef = useRef<Map<string, ToolCallState>>(new Map());

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const originalStateRef = useRef<ProposalState | null>(null);
  const messageClosedRef = useRef(false);

  // markdown-it
  const md = useMemo(
    () =>
      new MarkdownIt({
        html: false,
        linkify: true,
        breaks: true,
      }),
    []
  );

  // keep local in sync when not running
  useEffect(() => {
    if (!isRunning) {
      setLocalTitle(proposalState.title);
      setLocalContent(proposalState.content);
    }
  }, [proposalState.title, proposalState.content, isRunning]);

  // snapshot when run starts
  useEffect(() => {
    if (isRunning) {
      setSnapshotTitle(localTitle);
      setSnapshotContent(localContent);
    }
  }, [isRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd/Ctrl+E to toggle editor/preview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setViewMode((m) => (m === "editor" ? "preview" : "editor"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, currentMessage, activeToolCalls.size, isRunning]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || isRunning) return;

    const userMessage: Message = {
      id: `msg_user_${Date.now()}`,
      role: "user",
      content,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsRunning(true);
    messageClosedRef.current = false;

    // keep the original before the tool overwrites
    originalStateRef.current = { ...proposalState };

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.concat(userMessage).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          threadId: "thread_1",
          state: proposalState,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Agent API Error:", response.status, errorText);
        throw new Error(`Agent request failed: ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6);
          try {
            const event: AGUIEvent = JSON.parse(jsonStr);
            await handleEvent(event);
          } catch (e) {
            console.error("Error parsing event:", e, raw);
          }
        }
      }

      if (buffer.startsWith("data: ")) {
        try {
          await handleEvent(JSON.parse(buffer.slice(6)));
        } catch {}
      }
    } catch (error) {
      console.error("Send message error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_error_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        },
      ]);
      setIsRunning(false);
    }
  };

  const handleEvent = async (event: AGUIEvent) => {
    switch (event.type) {
      case EventType.RUN_STARTED:
        messageClosedRef.current = false;
        setIsRunning(true);
        return;

      case EventType.RUN_FINISHED:
        setIsRunning(false);
        setCurrentStep(null);
        if (currentMessage && !messageClosedRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: currentMessage.id,
              role: "assistant",
              content: currentMessage.content,
            },
          ]);
          setCurrentMessage(null);
        }
        return;

      case EventType.RUN_ERROR:
        setIsRunning(false);
        setCurrentStep(null);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_error_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            role: "assistant",
            content: `Error: ${event.message}`,
          },
        ]);
        return;

      case EventType.STEP_STARTED:
        setCurrentStep(event.stepName);
        return;

      case EventType.STEP_FINISHED:
        setCurrentStep(null);
        return;

      case EventType.TEXT_MESSAGE_START:
        setCurrentMessage({ id: event.messageId, content: "" });
        return;

      case EventType.TEXT_MESSAGE_CONTENT:
        setCurrentMessage((prev) =>
          prev
            ? { ...prev, content: prev.content + event.delta }
            : { id: event.messageId, content: event.delta }
        );
        return;

      case EventType.TEXT_MESSAGE_END:
        if (currentMessage && !messageClosedRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: currentMessage.id,
              role: "assistant",
              content: currentMessage.content,
            },
          ]);
          setCurrentMessage(null);
          messageClosedRef.current = true;
        }
        return;

      case EventType.TOOL_CALL_START:
        console.log("Tool call started:", event.toolCallName);
        setActiveToolCalls((prev) => {
          const updated = new Map(prev);
          updated.set(event.toolCallId, {
            id: event.toolCallId,
            name: event.toolCallName,
            args: "",
            status: "in_progress",
          });
          return updated;
        });
        return;

      case EventType.TOOL_CALL_ARGS:
        setActiveToolCalls((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(event.toolCallId);
          if (existing) {
            updated.set(event.toolCallId, {
              ...existing,
              args: existing.args + event.delta,
            });
          }
          return updated;
        });
        return;

      case EventType.TOOL_CALL_END:
        console.log("Tool call completed:", event.toolCallId);
        setActiveToolCalls((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(event.toolCallId);
          if (existing) {
            // Store in completed calls for TOOL_CALL_RESULT lookup
            completedToolCallsRef.current.set(event.toolCallId, {
              ...existing,
              status: "completed",
            });

            updated.set(event.toolCallId, {
              ...existing,
              status: "completed",
            });
          }
          return updated;
        });
        return;

      case EventType.TOOL_CALL_RESULT: {
        console.log("Tool call result received for:", event.toolCallId);

        // Check both active and completed tool calls
        let toolCall = Array.from(activeToolCalls.values()).find(
          (tc) => tc.id === event.toolCallId
        );

        if (!toolCall) {
          toolCall = completedToolCallsRef.current.get(event.toolCallId);
        }

        if (toolCall?.name === "screen_proposal") {
          console.log("Processing screening result");
          let result;
          try {
            result =
              typeof event.content === "string"
                ? JSON.parse(event.content)
                : event.content;
          } catch (e) {
            console.error("Failed to parse screen_proposal result:", e);
            result = event.content;
          }
          console.log(
            "Screening result:",
            result.overallPass ? "PASS ✓" : "FAIL ✕"
          );
          setProposalState((prev) => ({ ...prev, evaluation: result }));
        }

        setActiveToolCalls((prev) => {
          const updated = new Map(prev);
          updated.delete(event.toolCallId);
          return updated;
        });
        return;
      }

      case EventType.STATE_DELTA:
        console.log("STATE_DELTA received:", event.delta);

        try {
          // Apply the delta to get the new state
          setProposalState((prev) => {
            const result = applyPatch(
              prev,
              (event as StateDeltaEvent<ProposalState>).delta as Operation[],
              false,
              false
            );

            const newState = result.newDocument as ProposalState;

            // Check if content or title changed compared to LOCAL state (not prev state)
            const contentChanged = newState.content !== localContent;
            const titleChanged = newState.title !== localTitle;

            console.log("Content changed vs local:", contentChanged);
            console.log("Title changed vs local:", titleChanged);

            // If content changed, show it as a pending change for review
            if (contentChanged || titleChanged) {
              const newContent = newState.content || "";
              const newTitle = newState.title || prev.title;

              console.log("Changes detected - setting pending changes");

              // Store as pending changes
              setPendingTitle(newTitle);
              setPendingContent(newContent);

              // Generate diff
              const diff = diffPartialText(localContent || "", newContent);
              console.log("Generated diff HTML length:", diff.length);
              setContentDiffHtml(diff);

              // Show diff highlights
              setHasPendingChanges(true);
              setShowDiffHighlights(true);
            }

            return newState;
          });
        } catch (error) {
          console.error("Error applying STATE_DELTA:", error);
        }
        return;

      case EventType.STATE_SNAPSHOT: {
        const snapshot = (event as StateSnapshotEvent<ProposalState>).snapshot;
        setProposalState(snapshot);
        setLocalTitle(snapshot.title);
        setLocalContent(snapshot.content);
        return;
      }

      case EventType.MESSAGES_SNAPSHOT:
        setMessages((event as MessagesSnapshotEvent).messages);
        return;
    }
  };

  const handleAcceptChanges = () => {
    console.log("✓ Accepting AI changes");

    // Apply pending changes
    setProposalState({
      ...proposalState,
      title: pendingTitle,
      content: pendingContent,
    });
    setLocalTitle(pendingTitle);
    setLocalContent(pendingContent);

    // Clear pending state
    setHasPendingChanges(false);
    setShowDiffHighlights(false);
    setContentDiffHtml("");
    setPendingTitle("");
    setPendingContent("");
  };

  const handleRejectChanges = () => {
    console.log("✕ Rejecting AI changes");

    // Revert to original state
    if (originalStateRef.current) {
      setProposalState(originalStateRef.current);
      setLocalTitle(originalStateRef.current.title);
      setLocalContent(originalStateRef.current.content);
    }

    // Clear pending state
    setHasPendingChanges(false);
    setShowDiffHighlights(false);
    setContentDiffHtml("");
    setPendingTitle("");
    setPendingContent("");
  };

  const suggestions = [
    "Screen this proposal against NEAR criteria",
    "Write a proposal about improving developer documentation",
    "Add a detailed budget breakdown section",
    "Generate measurable KPIs for this proposal",
    "Improve the timeline to be more realistic",
  ];

  const renderedPreview = useMemo(
    () => md.render(localContent || ""),
    [md, localContent]
  );

  return (
    <div className="page-wrapper">
      <div
        style={{ maxWidth: "1400px", margin: "0 auto", padding: "2rem 1rem" }}
      >
        {/* Header Card - FULL WIDTH */}
        <div className="card" style={{ marginBottom: "2rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h1
                className="page-title"
                style={{ margin: 0, fontSize: "2rem" }}
              >
                Proposal Editor
              </h1>
              <p
                style={{
                  fontSize: "0.875rem",
                  color: "#6b7280",
                  margin: "0.25rem 0 0 0",
                }}
              >
                {isRunning ? "AI is working..." : "Ready to assist"}
              </p>
            </div>

            {/* Evaluation Badge */}
            {proposalState.evaluation && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <div
                  style={{
                    fontSize: "0.875rem",
                    color: "#6b7280",
                    fontWeight: "600",
                  }}
                >
                  {proposalState.evaluation.overallPass ? "Pass" : "Fail"}
                </div>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    background: proposalState.evaluation.overallPass
                      ? "#d1fae5"
                      : "#fee2e2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1rem",
                    fontWeight: "700",
                    color: proposalState.evaluation.overallPass
                      ? "#065f46"
                      : "#991b1b",
                  }}
                >
                  {proposalState.evaluation.overallPass ? "✓" : "✕"}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* TWO-COLUMN LAYOUT */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: "2rem",
            alignItems: "start",
            minHeight: "calc(100vh - 300px)",
          }}
        >
          {/* LEFT COLUMN - Editor */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2rem",
            }}
          >
            <div className="card">
              <EditorPane
                title={localTitle}
                content={localContent}
                setTitle={setLocalTitle}
                setContent={setLocalContent}
                disabled={isRunning}
                renderedPreview={renderedPreview}
                viewMode={viewMode}
                onToggleView={setViewMode}
                showDiffHighlights={showDiffHighlights}
                diffHtml={contentDiffHtml}
                hasPendingChanges={hasPendingChanges}
                onAcceptChanges={handleAcceptChanges}
                onRejectChanges={handleRejectChanges}
              />
            </div>
          </div>

          {/* RIGHT COLUMN - Assistant Sidebar */}
          <div
            style={{
              position: "sticky",
              top: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
              maxHeight: "calc(100vh - 150px)",
            }}
          >
            <div
              className="card"
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                maxHeight: "calc(100vh - 150px)",
                overflow: "hidden",
              }}
            >
              <SidebarChat
                currentStep={currentStep}
                messages={messages}
                currentMessage={currentMessage}
                activeToolCalls={activeToolCalls}
                isRunning={isRunning}
                suggestions={suggestions}
                inputMessage={inputMessage}
                setInputMessage={setInputMessage}
                sendMessage={sendMessage}
                evaluationSlot={
                  proposalState.evaluation ? (
                    <EvaluationSummary evaluation={proposalState.evaluation} />
                  ) : undefined
                }
              />
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
