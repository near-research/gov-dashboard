import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyPatch, type Operation } from "fast-json-patch";
import {
  EventType,
  type AGUIEvent,
  type MessagesSnapshotEvent,
  type StateDeltaEvent,
  type StateSnapshotEvent,
  type VerificationMetadata,
} from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";
import { diffPartialText } from "@/utils/ui/diff";
import type { Message, ToolCallState } from "./ProposalEditor";
import type { ProposalState } from "./ProposalEditorContext";

interface UseProposalChatParams {
  proposalState: ProposalState;
  setProposalState: React.Dispatch<React.SetStateAction<ProposalState>>;
  setEvaluationVerification: (v?: VerificationMetadata) => void;
  setEvaluationChatId: (id?: string) => void;
  localTitle: string;
  localContent: string;
  setLocalTitle: (v: string) => void;
  setLocalContent: (v: string) => void;
  setPendingTitle: (v: string) => void;
  setPendingContent: (v: string) => void;
  setContentDiffHtml: (v: string) => void;
  setHasPendingChanges: (v: boolean) => void;
  setShowDiffHighlights: (v: boolean) => void;
  originalStateRef: React.MutableRefObject<ProposalState | null>;
  setInputMessage: (v: string) => void;
}

export const useProposalChat = ({
  proposalState,
  setProposalState,
  setEvaluationVerification,
  setEvaluationChatId,
  localTitle,
  localContent,
  setLocalTitle,
  setLocalContent,
  setPendingTitle,
  setPendingContent,
  setContentDiffHtml,
  setHasPendingChanges,
  setShowDiffHighlights,
  originalStateRef,
  setInputMessage,
}: UseProposalChatParams) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<
    Map<string, ToolCallState>
  >(new Map());

  const completedToolCallsRef = useRef<Map<string, ToolCallState>>(
    new Map()
  );
  const messageClosedRef = useRef(false);

  const handleEvent = useCallback(
    async (event: AGUIEvent) => {
      switch (event.type) {
        case EventType.RUN_STARTED:
          messageClosedRef.current = false;
          setIsRunning(true);
          return;

        case EventType.RUN_FINISHED:
          setIsRunning(false);
          setCurrentStep(null);
          setCurrentMessage((prev) => {
            if (prev && !messageClosedRef.current) {
              setMessages((msgs) => [
                ...msgs,
                {
                  id: prev.id,
                  role: "assistant",
                  content: prev.content,
                  verification: prev.verification,
                  remoteId: prev.remoteId ?? prev.id,
                },
              ]);
              messageClosedRef.current = true;
            }
            return null;
          });
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
          setCurrentMessage({
            id: event.messageId,
            role: "assistant",
            content: "",
            verification: event.verification,
            remoteId: event.messageId,
          });
          return;

        case EventType.TEXT_MESSAGE_CONTENT:
          setCurrentMessage((prev) => {
            const nextVerification = event.verification ?? prev?.verification;
            if (prev) {
              return {
                ...prev,
                content: prev.content + event.delta,
                verification: nextVerification,
                remoteId: prev.remoteId ?? event.messageId,
                role: "assistant",
              };
            }
            return {
              id: event.messageId,
              role: "assistant",
              content: event.delta,
              verification: nextVerification,
              remoteId: event.messageId,
            };
          });
          return;

        case EventType.TEXT_MESSAGE_END:
          setCurrentMessage((prev) => {
            if (prev && !messageClosedRef.current) {
              setMessages((msgs) => [
                ...msgs,
                {
                  id: prev.id,
                  role: "assistant",
                  content: prev.content,
                  verification: event.verification ?? prev.verification,
                  remoteId: prev.remoteId ?? prev.id,
                },
              ]);
              messageClosedRef.current = true;
            }
            return null;
          });
          return;

        case EventType.TOOL_CALL_START:
          setActiveToolCalls((prev) => {
            const updated = new Map(prev);
            updated.set(event.toolCallId, {
              id: event.toolCallId,
              name: event.toolCallName,
              args: "",
              status: "in_progress",
              verification: event.verification,
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
                verification: event.verification ?? existing.verification,
              });
            }
            return updated;
          });
          return;

        case EventType.TOOL_CALL_END:
          setActiveToolCalls((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(event.toolCallId);
            if (existing) {
              completedToolCallsRef.current.set(event.toolCallId, {
                ...existing,
                status: "completed",
                verification: event.verification ?? existing.verification,
              });

              updated.set(event.toolCallId, {
                ...existing,
                status: "completed",
                verification: event.verification ?? existing.verification,
              });
            }
            return updated;
          });
          return;

        case EventType.TOOL_CALL_RESULT: {
          let toolCall = Array.from(activeToolCalls.values()).find(
            (tc) => tc.id === event.toolCallId
          );

          if (!toolCall) {
            toolCall = completedToolCallsRef.current.get(event.toolCallId);
          }

          if (toolCall?.name === "screen_proposal") {
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
            setProposalState((prev: ProposalState) => ({ ...prev, evaluation: result as Evaluation }));
          }

          setActiveToolCalls((prev) => {
            const updated = new Map(prev);
            updated.delete(event.toolCallId);
            return updated;
          });
          return;
        }

        case EventType.STATE_DELTA: {
          const delta = (event as StateDeltaEvent<ProposalState>).delta;
          const evaluationUpdated = Array.isArray(delta)
            ? (delta as Operation[]).some((op) => op.path === "/evaluation")
            : false;
          if (evaluationUpdated && event.verification) {
            setEvaluationVerification(event.verification);
            setEvaluationChatId(event.verification.messageId);
          }

          try {
            setProposalState((prev: ProposalState) => {
              const result = applyPatch(prev, delta as Operation[], false, false);
              const newState = result.newDocument as ProposalState;

              const contentChanged = newState.content !== localContent;
              const titleChanged = newState.title !== localTitle;

              if (contentChanged || titleChanged) {
                const newContent = newState.content || "";
                const newTitle = newState.title || prev.title;

                setPendingTitle(newTitle);
                setPendingContent(newContent);

                const diff = diffPartialText(localContent || "", newContent);
                setContentDiffHtml(diff);
                setHasPendingChanges(true);
                setShowDiffHighlights(true);
              }

              return newState;
            });
          } catch (error) {
            console.error("Error applying STATE_DELTA:", error);
          }
          return;
        }

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
    },
    [
      activeToolCalls,
      localContent,
      localTitle,
      setContentDiffHtml,
      setEvaluationChatId,
      setEvaluationVerification,
      setHasPendingChanges,
      setLocalContent,
      setLocalTitle,
      setPendingContent,
      setPendingTitle,
      setProposalState,
      setShowDiffHighlights,
    ]
  );

  const sendMessage = useCallback(
    async (content: string) => {
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
          } catch {
            // ignore trailing parse errors
          }
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
    },
    [handleEvent, isRunning, messages, proposalState, setInputMessage, originalStateRef]
  );

  const stateSnapshot = useMemo(
    () => ({
      messages,
      isRunning,
      currentMessage,
      currentStep,
      activeToolCalls,
    }),
    [messages, isRunning, currentMessage, currentStep, activeToolCalls]
  );

  return {
    messages: stateSnapshot.messages,
    isRunning: stateSnapshot.isRunning,
    currentMessage: stateSnapshot.currentMessage,
    currentStep: stateSnapshot.currentStep,
    activeToolCalls: stateSnapshot.activeToolCalls,
    sendMessage,
  };
};
