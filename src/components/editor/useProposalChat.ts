import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { applyPatch, type Operation } from "fast-json-patch";
import {
  EventType,
  type AGUIEvent,
  type CustomEvent,
  type MessagesSnapshotEvent,
  type StateDeltaEvent,
  type StateSnapshotEvent,
  type VerificationMetadata,
} from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";
import { diffPartialText } from "@/utils/ui/diff";
import type { Message, ToolCallState } from "./types";
import type { PendingDelta, ProposalState } from "./ProposalEditorContext";
import { logger } from "@/lib/logger";

type VerificationProof = {
  stage: "initial_reasoning" | "final_synthesis";
  verificationId: string;
  requestHash: string;
  responseHash: string;
  messageId: string;
  timestamp: number;
};

interface UseProposalChatParams {
  proposalState: ProposalState;
  setProposalState: React.Dispatch<React.SetStateAction<ProposalState>>;
  setEvaluationVerification: (v?: VerificationMetadata) => void;
  setEvaluationChatId: (id?: string) => void;
  localTitle: string;
  localContent: string;
  setLocalTitle: (v: string) => void;
  setLocalContent: (v: string) => void;
  setPending: (title: string, content: string) => void;
  setContentDiffHtml: (v: string) => void;
  setHasPendingChanges: (v: boolean) => void;
  setShowDiffHighlights: (v: boolean) => void;
  originalStateRef: React.MutableRefObject<ProposalState | null>;
  setInputMessage: (v: string) => void;
  addPendingDelta: (delta: PendingDelta) => void;
}

const SESSION_STORAGE_KEY = "proposal_chat_session_v1";

const generateMessageId = (prefix: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${timestamp}_${random}`;
};

function useThrottledCallback<T extends (...args: never[]) => void>(
  callback: T,
  delay: number
): T & { cancel: () => void; flush: () => void } {
  const lastRun = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingArgs = useRef<Parameters<T> | null>(null);

  const throttled = useCallback(
    (...args: Parameters<T>) => {
      pendingArgs.current = args;
      const now = Date.now();
      const remaining = delay - (now - lastRun.current);

      if (remaining <= 0) {
        if (timeout.current) {
          clearTimeout(timeout.current);
          timeout.current = undefined;
        }
        lastRun.current = now;
        pendingArgs.current = null;
        callback(...args);
      } else if (!timeout.current) {
        timeout.current = setTimeout(() => {
          lastRun.current = Date.now();
          timeout.current = undefined;
          if (pendingArgs.current) {
            callback(...pendingArgs.current);
            pendingArgs.current = null;
          }
        }, remaining);
      }
    },
    [callback, delay]
  ) as T & { cancel: () => void; flush: () => void };

  throttled.cancel = () => {
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = undefined;
    }
    pendingArgs.current = null;
  };

  throttled.flush = () => {
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = undefined;
    }
    if (pendingArgs.current) {
      lastRun.current = Date.now();
      callback(...pendingArgs.current);
      pendingArgs.current = null;
    }
  };

  useEffect(() => {
    return () => throttled.cancel();
  }, [throttled]);

  return throttled;
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
  setPending,
  setContentDiffHtml,
  setHasPendingChanges,
  setShowDiffHighlights,
  originalStateRef,
  setInputMessage,
  addPendingDelta,
}: UseProposalChatParams) => {
  const abortControllerRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);

  const sessionKey =
    typeof window === "undefined" ? null : SESSION_STORAGE_KEY;

  const throttledPersist = useThrottledCallback(
    (key: string, data: unknown) => {
      try {
        const toStore = Array.isArray(data) ? data.slice(-100) : data;
        sessionStorage.setItem(key, JSON.stringify(toStore));
      } catch (e) {
        console.warn("[sessionStorage] Write failed:", e);
      }
    },
    1000
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const flushOnUnload = () => {
      throttledPersist.flush();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        throttledPersist.flush();
      }
    };

    window.addEventListener("beforeunload", flushOnUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushOnUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [throttledPersist]);

  useEffect(() => {
    return () => {
      throttledPersist.flush();
      throttledPersist.cancel();
    };
  }, [throttledPersist]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<
    Map<string, ToolCallState>
  >(new Map());
  const [verificationProofs, setVerificationProofs] = useState<
    VerificationProof[]
  >([]);
  const [currentTurn, setCurrentTurn] = useState(0);

  const completedToolCallsRef = useRef<Map<string, ToolCallState>>(
    new Map()
  );
  const messageClosedRef = useRef(false);
  const sessionMetadataRef = useRef<{
    threadId: string;
    runId: string;
    parentRunId?: string;
  }>({
    threadId: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    runId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    parentRunId: undefined,
  });

  useEffect(() => {
    if (!sessionKey || hydratedRef.current) return;
    hydratedRef.current = true;

    const stored = sessionStorage.getItem(sessionKey);
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed?.messages)) {
        setMessages(parsed.messages);
      }
      if (parsed?.proposalState) {
        setProposalState(parsed.proposalState);
      }
      if (parsed?.currentTurn != null) {
        setCurrentTurn(parsed.currentTurn);
      }
      sessionMetadataRef.current = {
        threadId: parsed?.threadId ?? sessionMetadataRef.current.threadId,
        runId: parsed?.runId ?? sessionMetadataRef.current.runId,
        parentRunId: parsed?.parentRunId,
      };
    } catch (error) {
      logger.warn("[useProposalChat] Failed to hydrate session:", error);
    }
  }, [sessionKey, setProposalState]);

  useEffect(() => {
    if (!sessionKey) return;

    throttledPersist(sessionKey, {
      messages,
      proposalState,
      threadId: sessionMetadataRef.current.threadId,
      runId: sessionMetadataRef.current.runId,
      parentRunId: sessionMetadataRef.current.parentRunId,
      currentTurn,
    });
  }, [messages, proposalState, sessionKey, currentTurn, throttledPersist]);

  const finalizeCurrentMessage = useCallback(() => {
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
  }, []);

  const resetToolState = useCallback(() => {
    setActiveToolCalls(new Map());
    completedToolCallsRef.current.clear();
  }, []);

  const handleEvent = useCallback(
    async (event: AGUIEvent) => {
      switch (event.type) {
        case EventType.RUN_STARTED:
          sessionMetadataRef.current = {
            threadId: event.threadId ?? sessionMetadataRef.current.threadId,
            runId: event.runId ?? sessionMetadataRef.current.runId,
            parentRunId:
              event.parentRunId ?? sessionMetadataRef.current.parentRunId,
          };
          messageClosedRef.current = false;
          setIsRunning(true);
          return;

        case EventType.RUN_FINISHED:
          setIsRunning(false);
          setCurrentStep(null);
          finalizeCurrentMessage();
          return;

        case EventType.RUN_ERROR:
          setIsRunning(false);
          setCurrentStep(null);
          finalizeCurrentMessage();
          resetToolState();
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
          const toolCallId = event.toolCallId;
          let toolCall: ToolCallState | undefined;
          if (toolCallId) {
            toolCall = Array.from(activeToolCalls.values()).find((tc) => tc.id === toolCallId);
          }

          if (!toolCall && toolCallId) {
            toolCall = completedToolCallsRef.current.get(toolCallId);
          }

          if (toolCall?.name === "screen_proposal") {
            let result;
            try {
              result =
                typeof event.content === "string"
                  ? JSON.parse(event.content)
                  : event.content;
            } catch (e) {
              logger.error("Failed to parse screen_proposal result:", e);
              result = event.content;
            }
            setProposalState((prev: ProposalState) => ({ ...prev, evaluation: result as Evaluation }));
          }

          if (toolCallId) {
            setActiveToolCalls((prev) => {
              const updated = new Map(prev);
              updated.delete(toolCallId);
              return updated;
            });
          }
          return;
        }

        case EventType.STATE_DELTA: {
          const delta = (event as StateDeltaEvent<ProposalState>).delta;
          const operations = Array.isArray(delta) ? (delta as Operation[]) : [];
          const evaluationUpdated = operations.some((op) => op.path === "/evaluation");
          if (evaluationUpdated && event.verification) {
            setEvaluationVerification(event.verification);
            setEvaluationChatId(event.verification.messageId);
          }

          const evaluationOps = operations.filter((op) => op.path?.startsWith("/evaluation"));
          const nonEvaluationOps = operations.filter((op) => !op.path?.startsWith("/evaluation"));
          const affectedPaths = nonEvaluationOps.map((op) => op.path ?? "");
          const affectsTitle = affectedPaths.some((path) => path.startsWith("/title"));
          const affectsContent = affectedPaths.some((path) => path.startsWith("/content"));
          const affectsEvaluation = evaluationOps.length > 0;

          const hasLocalTitleEdit = localTitle !== originalStateRef.current?.title;
          const hasLocalContentEdit = localContent !== originalStateRef.current?.content;
          const hasConflict =
            (affectsTitle && hasLocalTitleEdit) || (affectsContent && hasLocalContentEdit);

          if (hasConflict) {
            if (evaluationOps.length > 0) {
              try {
                setProposalState((prev) => {
                  const result = applyPatch(prev, evaluationOps, true, false);
                  return result.newDocument as ProposalState;
                });
              } catch (patchError) {
                logger.error("[Chat] Failed to apply evaluation delta:", patchError);
              }
            }

            if (nonEvaluationOps.length === 0) {
              return;
            }

            logger.warn("[Chat] STATE_DELTA conflicts with local edits, buffering for review");

            let previewState: ProposalState | null = null;
            try {
              const previewBase = { ...proposalState };
              const previewResult = applyPatch(previewBase, operations, true, false);
              previewState = previewResult.newDocument as ProposalState;
            } catch (previewError) {
              logger.error("[Chat] Failed to generate delta preview:", previewError);
            }

            addPendingDelta({
              id: generateMessageId("delta"),
              delta: nonEvaluationOps,
              timestamp: Date.now(),
              affectedPaths,
              preview: {
                title: affectsTitle ? previewState?.title : undefined,
                content: affectsContent ? previewState?.content : undefined,
                evaluation: affectsEvaluation ? previewState?.evaluation : undefined,
              },
            });

            return;
          }

          try {
            setProposalState((prev: ProposalState) => {
              try {
                const result = applyPatch(prev, operations, true, false);
                const newState = result.newDocument as ProposalState;

                const contentChanged = newState.content !== localContent;
                const titleChanged = newState.title !== localTitle;

                if (contentChanged || titleChanged) {
                  const newContent = newState.content || "";
                  const newTitle = newState.title || prev.title;

                  setPending(newTitle, newContent);

                  const diff = diffPartialText(localContent || "", newContent);
                  setContentDiffHtml(diff);
                  setHasPendingChanges(true);
                  setShowDiffHighlights(true);
                }

                return newState;
              } catch (patchError) {
                logger.error("[Chat] Invalid STATE_DELTA patch:", {
                  error: patchError,
                  delta,
                  currentState: prev,
                });
                return prev;
              }
            });
          } catch (error) {
            logger.error("Error applying STATE_DELTA:", error);
          }
          return;
        }

        case EventType.CUSTOM: {
          const customEvent = event as CustomEvent;
          if (customEvent.name === "verification" && customEvent.value) {
            const payload = customEvent.value as {
              stage?: "initial_reasoning" | "final_synthesis";
              verificationId?: string;
              requestHash?: string;
              responseHash?: string;
              messageId?: string;
            };
            logger.debug("[Chat] Verification proof received:", {
              stage: payload.stage,
              verificationId: payload.verificationId,
            });

            const { verificationId, requestHash, responseHash, messageId, stage } =
              payload;
            if (verificationId && requestHash && responseHash) {
              setVerificationProofs((prev) => [
                ...prev,
                {
                  stage: stage || "initial_reasoning",
                  verificationId,
                  requestHash,
                  responseHash,
                  messageId: messageId || "",
                  timestamp: Date.now(),
                },
              ]);
            }

            if (messageId) {
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.remoteId !== messageId && msg.id !== messageId) {
                    return msg;
                  }
                  const baseVerification: VerificationMetadata = msg.verification ?? {
                    source: "near-ai-cloud",
                    status: "pending",
                    messageId,
                  };
                  return {
                    ...msg,
                    verification: {
                      ...baseVerification,
                      status: "verified" as const,
                      messageId: baseVerification.messageId ?? messageId,
                    },
                  };
                })
              );
            }

            setCurrentMessage((prev) => {
              if (!prev) {
                return prev;
              }
              const baseVerification: VerificationMetadata = prev.verification ?? {
                source: "near-ai-cloud",
                status: "pending",
              };
              return {
                ...prev,
                verification: {
                  ...baseVerification,
                  status: "verified" as const,
                  messageId: messageId ?? baseVerification.messageId,
                },
              };
            });
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
      addPendingDelta,
      finalizeCurrentMessage,
      localContent,
      localTitle,
      originalStateRef,
      proposalState,
      resetToolState,
      setContentDiffHtml,
      setEvaluationChatId,
      setEvaluationVerification,
      setHasPendingChanges,
      setLocalContent,
      setLocalTitle,
      setPending,
      setProposalState,
      setShowDiffHighlights,
      setVerificationProofs,
    ]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isRunning) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const previousRunId = sessionMetadataRef.current.runId;
      const newRunId = `run_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      sessionMetadataRef.current = {
        ...sessionMetadataRef.current,
        runId: newRunId,
        parentRunId: previousRunId,
      };

      const userMessage: Message = {
        id: generateMessageId("msg_user"),
        role: "user",
        content,
      };

      setCurrentTurn((prev) => prev + 1);

      setMessages((prev) => [...prev, userMessage]);
      setInputMessage("");
      setIsRunning(true);
      messageClosedRef.current = false;
      originalStateRef.current = {
        title: localTitle,
        content: localContent,
        evaluation: proposalState.evaluation,
      };
      let receivedTerminalEvent = false;

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messages.concat(userMessage).map((m) => ({
              role: m.role,
              content: m.content,
            })),
            threadId: sessionMetadataRef.current.threadId,
            runId: sessionMetadataRef.current.runId,
            parentRunId: sessionMetadataRef.current.parentRunId,
            state: proposalState,
          }),
          signal: abortControllerRef.current?.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("Agent API Error:", response.status, errorText);
          throw new Error(`Agent request failed: ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (abortControllerRef.current?.signal.aborted) {
            await reader.cancel();
            break;
          }

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
              if (
                event.type === EventType.RUN_FINISHED ||
                event.type === EventType.RUN_ERROR
              ) {
                receivedTerminalEvent = true;
              }
              await handleEvent(event);
            } catch (e) {
              logger.error("Error parsing event:", e, raw);
            }
          }
        }

        if (buffer.startsWith("data: ")) {
          try {
            const event = JSON.parse(buffer.slice(6)) as AGUIEvent;
            if (
              event.type === EventType.RUN_FINISHED ||
              event.type === EventType.RUN_ERROR
            ) {
              receivedTerminalEvent = true;
            }
            await handleEvent(event);
          } catch {
            // ignore trailing parse errors
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          logger.debug("[Chat] Request aborted by user or unmount");
          return;
        }

        logger.error("Send message error:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: generateMessageId("msg_error"),
            role: "assistant",
            content: "Sorry, something went wrong. Please try again.",
          },
        ]);
      } finally {
        const wasAborted = abortControllerRef.current?.signal.aborted;
        if (!wasAborted && !receivedTerminalEvent) {
          logger.warn("[Chat] Stream ended without terminal event - cleaning up");
          setCurrentMessage((prev) => {
            if (prev && !messageClosedRef.current) {
              setMessages((msgs) => [
                ...msgs,
                {
                  id: prev.id,
                  role: "assistant",
                  content: prev.content + " [Connection interrupted]",
                  verification: prev.verification,
                  remoteId: prev.remoteId ?? prev.id,
                },
              ]);
              messageClosedRef.current = true;
            }
            return null;
          });
        }
        setIsRunning(false);
        setCurrentStep(null);
        abortControllerRef.current = null;
      }
    },
    [
      handleEvent,
      isRunning,
      localContent,
      localTitle,
      messages,
      originalStateRef,
      proposalState,
      setInputMessage,
    ]
  );

  const stateSnapshot = useMemo(
    () => ({
      messages,
      isRunning,
      currentMessage,
      currentStep,
      activeToolCalls,
      verificationProofs,
    }),
    [messages, isRunning, currentMessage, currentStep, activeToolCalls, verificationProofs]
  );

  return {
    messages: stateSnapshot.messages,
    isRunning: stateSnapshot.isRunning,
    currentMessage: stateSnapshot.currentMessage,
    currentStep: stateSnapshot.currentStep,
    activeToolCalls: stateSnapshot.activeToolCalls,
    verificationProofs: stateSnapshot.verificationProofs,
    sendMessage,
  };
};
