// components/chat/Chat.tsx
"use client";

import { useState, useRef, useEffect, useMemo, useReducer } from "react";
import MarkdownIt from "markdown-it";
import { toast } from "sonner";
import { applyPatch, type Operation } from "fast-json-patch";
import { ChatMessages } from "./ChatMessages";
import { ChatInput, type ChatQuickAction } from "./ChatInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EventType,
  type AGUIEvent,
  type AgentState,
  type VerificationMetadata,
} from "@/types/agui-events";
import {
  reduceAguiEventsToUiEvents,
  mapRoleToDisplayRoleMeta,
  type AgentUIEvent,
  type MessageUIEvent,
  type MessageProof,
} from "@/types/agent-ui";
import { AGENT_MODEL } from "@/constants/agent";
import { useGovernanceAnalytics } from "@/lib/analytics";
import { logger } from "@/lib/logger";

type AgentRole = "user" | "assistant" | "system";

export interface AgentChatPanelProps {
  model?: string;
  className?: string;
  placeholder?: string;
  welcomeMessage?: string;
  state?: Partial<AgentState>;
  threadId?: string;
  runId?: string;
  quickActions?: ChatQuickAction[];
  trackingPath?: string | null;
}

const generateEventId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const SESSION_STORAGE_KEY = "agent_chat_session_v1";
const MAX_PERSISTED_EVENTS = 200;
const MAX_PERSISTED_BYTES = 50_000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mapMessageRoleToAgentRole = (
  role: MessageUIEvent["role"]
): AgentRole | null => {
  const meta = mapRoleToDisplayRoleMeta(role);
  return meta.role;
};

export type EventsState = {
  byId: Record<string, AgentUIEvent>;
  order: string[];
};

type EventsAction =
  | { type: "set_all"; events: AgentUIEvent[] }
  | { type: "add"; event: AgentUIEvent }
  | { type: "remove"; id: string }
  | {
      type: "update";
      id: string;
      updater: (event: AgentUIEvent) => AgentUIEvent;
    }
  | { type: "mark_tools_failed" }
  | {
      type: "batch_apply";
      aguiEvents: AGUIEvent[];
      turnNumber: number;
    };

export const eventsReducer = (
  state: EventsState,
  action: EventsAction
): EventsState => {
  switch (action.type) {
    case "set_all": {
      const byId: Record<string, AgentUIEvent> = {};
      const order = action.events.map((event) => {
        byId[event.id] = event;
        return event.id;
      });
      return { byId, order };
    }
    case "add": {
      if (state.byId[action.event.id]) {
        return state;
      }
      return {
        byId: { ...state.byId, [action.event.id]: action.event },
        order: [...state.order, action.event.id],
      };
    }
    case "remove": {
      if (!state.byId[action.id]) return state;
      const nextById = { ...state.byId };
      delete nextById[action.id];
      return {
        byId: nextById,
        order: state.order.filter((eventId) => eventId !== action.id),
      };
    }
    case "update": {
      const existing = state.byId[action.id];
      if (!existing) return state;
      const updated = action.updater(existing);
      if (updated === existing) return state;
      return {
        byId: { ...state.byId, [action.id]: updated },
        order: state.order,
      };
    }
    case "mark_tools_failed": {
      const nextById: Record<string, AgentUIEvent> = { ...state.byId };
      let changed = false;
      state.order.forEach((id) => {
        const event = nextById[id];
        if (
          event?.kind === "tool_call" &&
          (event.status === "pending" || event.status === "running")
        ) {
          nextById[id] = {
            ...event,
            status: "failed",
          };
          changed = true;
        }
      });
      if (!changed) return state;
      return { byId: nextById, order: state.order };
    }
    case "batch_apply": {
      if (action.aguiEvents.length === 0) return state;
      const currentEvents = state.order.map((id) => state.byId[id]);
      const updatedEvents = action.aguiEvents.reduce(
        (acc, incoming) =>
          reduceAguiEventsToUiEvents(acc, incoming, {
            turnNumber: action.turnNumber,
          }),
        currentEvents
      );

      let changed = false;
      const nextById = { ...state.byId };
      let nextOrder = state.order;

      updatedEvents.forEach((event) => {
        const existing = state.byId[event.id];
        if (!existing) {
          nextOrder = [...nextOrder, event.id];
          changed = true;
        }
        if (!existing || existing !== event) {
          nextById[event.id] = event;
          changed = true;
        }
      });

      return changed ? { byId: nextById, order: nextOrder } : state;
    }
    default:
      return state;
  }
};

const selectEventsArray = (state: EventsState) =>
  state.order.map((id) => state.byId[id]).filter(Boolean) as AgentUIEvent[];

const stripJsonBlocks = (content: string): string =>
  content.replace(/```json[\s\S]*?```/gi, "").trim();

export const selectConversationHistory = (
  state: EventsState
): Array<{ role: AgentRole; content: string }> =>
  state.order
    .map((id) => state.byId[id])
    .filter((event): event is MessageUIEvent => event?.kind === "message")
    .filter((event) => event.status === "completed")
    .map((event) => {
      const mappedRole = mapMessageRoleToAgentRole(event.role);
      if (!mappedRole) return null;
      const sanitizedContent =
        mappedRole === "assistant"
          ? stripJsonBlocks(event.content)
          : event.content;
      if (!sanitizedContent) return null;
      return { role: mappedRole, content: sanitizedContent };
    })
    .filter(
      (entry): entry is { role: AgentRole; content: string } => entry !== null
    );

const deriveEventsAndHistory = (
  state: EventsState,
  extraEvents: AgentUIEvent[] = []
) => {
  const mergedState: EventsState = {
    byId: { ...state.byId },
    order: [...state.order],
  };

  extraEvents.forEach((event) => {
    mergedState.byId[event.id] = event;
    if (!mergedState.order.includes(event.id)) {
      mergedState.order.push(event.id);
    }
  });

  return {
    events: selectEventsArray(mergedState),
    history: selectConversationHistory(mergedState),
  };
};

export const prepareEventsForPersistence = (
  events: AgentUIEvent[]
): AgentUIEvent[] => {
  let trimmed = events.slice(-MAX_PERSISTED_EVENTS);
  while (
    trimmed.length > 0 &&
    JSON.stringify({ events: trimmed }).length > MAX_PERSISTED_BYTES
  ) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
};

export const AgentChatPanel = ({
  model = AGENT_MODEL,
  className = "",
  placeholder = "Ask me anything about NEAR proposals…",
  welcomeMessage = "Welcome to the NEAR AI proposal agent.",
  state,
  threadId,
  runId,
  quickActions = [],
  trackingPath = "/",
}: AgentChatPanelProps) => {
  const [eventsState, dispatchEvents] = useReducer(eventsReducer, {
    byId: {},
    order: [],
  });
  const events = selectEventsArray(eventsState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [inputHeight, setInputHeight] = useState(220);
  const [currentTurn, setCurrentTurn] = useState(0);

  const agentStateRef = useRef<Partial<AgentState> | undefined>(state);
  const lastUserMessageRef = useRef<string>("");
  const hasHydratedRef = useRef(false);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionMetadataRef = useRef<{
    threadId?: string;
    runId?: string;
    parentRunId?: string;
  } | null>(null);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  const track = useGovernanceAnalytics();
  const analyticsPath = trackingPath ?? "/";
  useEffect(() => {
    track("agent_chat_opened", {
      props: { path: analyticsPath },
    });
  }, [analyticsPath, track]);

  const markdown = useMemo(
    () =>
      new MarkdownIt({
        html: false,
        linkify: true,
        breaks: true,
      }),
    []
  );

  useEffect(() => {
    if (typeof window === "undefined" || hasHydratedRef.current) return;
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        events?: AgentUIEvent[];
        agentState?: Partial<AgentState>;
        threadId?: string;
        runId?: string;
        parentRunId?: string;
        currentTurn?: number;
      };
      const storedEvents = parsed.events;
      if (Array.isArray(storedEvents)) {
        const hydratedEvents = storedEvents.map((event) => ({
          ...event,
          timestamp: new Date(event.timestamp),
          turnNumber: event.turnNumber ?? 0,
        }));
        dispatchEvents({ type: "set_all", events: hydratedEvents });
        const lastUserEvent = storedEvents
          .filter((event) => event.kind === "message" && event.role === "user")
          .pop();
        if (lastUserEvent?.turnNumber) {
          setCurrentTurn(lastUserEvent.turnNumber);
        }
      }
      if (parsed.agentState) {
        agentStateRef.current = parsed.agentState;
      }
      if (typeof parsed.currentTurn === "number") {
        setCurrentTurn(parsed.currentTurn);
      }
      const existingMetadata = sessionMetadataRef.current ?? {};
      sessionMetadataRef.current = {
        threadId:
          parsed.threadId ??
          existingMetadata.threadId ??
          threadId ??
          undefined,
        runId:
          parsed.runId ??
          existingMetadata.runId ??
          runId ??
          undefined,
        parentRunId:
          parsed.parentRunId ?? existingMetadata.parentRunId,
      };
      hasHydratedRef.current = true;
    } catch (hydrationError) {
      logger.error("Failed to hydrate agent chat", hydrationError);
    }
  }, [runId, threadId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const eventsToPersist = prepareEventsForPersistence(events);
      const metadata = sessionMetadataRef.current ?? {
        threadId,
        runId,
      };
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          events: eventsToPersist,
          threadId: metadata.threadId,
          runId: metadata.runId,
          parentRunId: metadata.parentRunId,
          currentTurn,
          agentState: agentStateRef.current,
        })
      );
    } catch (persistError) {
      logger.warn("Unable to persist agent chat session", persistError);
    }
  }, [events, threadId, runId, currentTurn]);

  useEffect(() => {
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    agentStateRef.current = state;
  }, [state]);

  useEffect(() => {
    const existingMetadata = sessionMetadataRef.current ?? {};
    sessionMetadataRef.current = {
      threadId: threadId ?? existingMetadata.threadId,
      runId: runId ?? existingMetadata.runId,
      parentRunId: existingMetadata.parentRunId,
    };
  }, [threadId, runId]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const addEvent = (event: AgentUIEvent) => {
    dispatchEvents({ type: "add", event });
  };

  interface UpdateMessageData {
    content?: string;
    messageId?: string;
    verification?: VerificationMetadata;
    proof?: MessageProof;
    status?: MessageUIEvent["status"];
  }

  const updateMessageEvent = (id: string, data: UpdateMessageData) => {
    dispatchEvents({
      type: "update",
      id,
      updater: (event) => {
        if (event.kind !== "message") return event;
        const next: MessageUIEvent = { ...event };
        if (data.content !== undefined) next.content = data.content;
        if (data.messageId !== undefined) next.messageId = data.messageId;
        if (data.status !== undefined) next.status = data.status;
        if (data.verification) {
          next.verification = {
            ...(event.verification ?? {
              source: "near-ai-cloud",
              status: "pending",
            }),
            ...data.verification,
          };
        }
        if (data.proof) {
          next.proof = {
            ...(event.proof ?? {}),
            ...data.proof,
          };
        }
        return next;
      },
    });
  };

  const removeEventById = (id: string) => {
    dispatchEvents({ type: "remove", id });
  };

  const failActiveTools = () => {
    dispatchEvents({ type: "mark_tools_failed" });
  };

  const handleSend = async (message: string) => {
    const nextTurn = currentTurn + 1;
    setCurrentTurn(nextTurn);
    lastUserMessageRef.current = message;

    const timestamp = new Date();
    const userEvent: MessageUIEvent = {
      kind: "message",
      id: generateEventId(),
      role: "user",
      content: message,
      status: "completed",
      timestamp,
      turnNumber: nextTurn,
    };

    const { history: conversationHistorySnapshot } = deriveEventsAndHistory(
      eventsState,
      [userEvent]
    );

    // Track message sent
    track("agent_chat_message_sent", {
      props: {
        length: message.length,
        turn_number: nextTurn,
        has_history: conversationHistorySnapshot.length > 0,
      },
    });

    dispatchEvents({ type: "add", event: userEvent });

    setIsLoading(true);
    setError(null);

    try {
      setChatError(null);
      await sendStreamingMessage(nextTurn, conversationHistorySnapshot);
    } catch (sendError) {
      const messageText =
        sendError instanceof Error
          ? sendError.message
          : "Failed to get response";
      setError(messageText);
      setChatError(messageText);
      failActiveTools();
      setChatError(messageText);
      toast.error("Agent error", { description: messageText });
    } finally {
      setIsLoading(false);
    }
  };

  const sendStreamingMessage = async (
    turnNumber: number,
    conversationHistory: Array<{ role: AgentRole; content: string }>
  ) => {
    // Track run started
    track("agent_chat_run_started", {
      props: {
        turn_number: turnNumber,
      },
    });

    const assistantEventId = generateEventId();
    let fullContent = "";
    const initialProofData: MessageProof = { stage: "initial_reasoning" };
    const synthesisProofData: MessageProof = { stage: "final_synthesis" };
    let initialProofRequested = false;
    let synthesisProofRequested = false;

    streamingAssistantIdRef.current = assistantEventId;

    addEvent({
      kind: "message",
      id: assistantEventId,
      role: "assistant",
      content: "",
      status: "in_progress",
      timestamp: new Date(),
      turnNumber,
    });
    const abortController = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = abortController;

    try {
      const verificationId = `chatcmpl-${crypto.randomUUID()}`;
      const sessionResp = await fetch("/api/verification/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId }),
        signal: abortController.signal,
      });
      if (!sessionResp.ok) {
        throw new Error("Failed to register verification session");
      }
      const { nonce } = await sessionResp.json();

      initialProofData.nonce = nonce;
      initialProofData.verificationId = verificationId;

      updateMessageEvent(assistantEventId, {
        proof: { ...initialProofData },
        verification: {
          source: "near-ai-cloud",
          status: "pending",
          messageId: verificationId,
        },
      });

      const metadata = sessionMetadataRef.current ?? { threadId, runId };
      const bodyPayload = JSON.stringify({
        messages: conversationHistory,
        state: agentStateRef.current,
        threadId: metadata.threadId,
        runId: metadata.runId,
        verificationId,
        verificationNonce: nonce,
      });

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyPayload,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorPayload = await response.text();
        throw new Error(
          `Agent API error: ${response.status} - ${
            errorPayload || response.statusText
          }`
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const handleCustomVerification = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const payload = value as Record<string, unknown>;

        const stage = payload.stage as
          | "initial_reasoning"
          | "final_synthesis"
          | undefined;
        const isInitial = stage === "initial_reasoning";
        const isSynthesis = stage === "final_synthesis";

        const targetProof = isInitial
          ? initialProofData
          : isSynthesis
          ? synthesisProofData
          : null;

        if (!targetProof) {
          logger.warn("[verification] Unknown stage:", stage);
          return;
        }

        if (typeof payload.verificationId === "string") {
          targetProof.verificationId = payload.verificationId;
        }
        if (typeof payload.requestHash === "string") {
          targetProof.requestHash = payload.requestHash;
        }
        if (typeof payload.responseHash === "string") {
          targetProof.responseHash = payload.responseHash;
        }
        if (typeof payload.nonce === "string") {
          targetProof.nonce = payload.nonce;
        }
        if (typeof payload.messageId === "string") {
          targetProof.messageId = payload.messageId;
        }

        updateMessageEvent(assistantEventId, {
          proof: {
            ...(isSynthesis ? synthesisProofData : initialProofData),
          },
          verification: payload as unknown as VerificationMetadata,
        });
      };

      const pendingAguiEvents: AGUIEvent[] = [];

      const flushPendingEvents = () => {
        if (pendingAguiEvents.length === 0) return;
        dispatchEvents({
          type: "batch_apply",
          aguiEvents: [...pendingAguiEvents],
          turnNumber,
        });
        pendingAguiEvents.length = 0;
      };

      const handleAgentEvent = (event: AGUIEvent) => {
        pendingAguiEvents.push(event);
        switch (event.type) {
          case EventType.RUN_STARTED: {
            sessionMetadataRef.current = {
              threadId: event.threadId,
              runId: event.runId,
              parentRunId: event.parentRunId,
            };
            break;
          }
          case EventType.RUN_ERROR: {
            const messageText = event.message || "Agent run failed";
            setError(messageText);
            setChatError(messageText);
            failActiveTools();
            break;
          }
          case EventType.TEXT_MESSAGE_CONTENT:
            fullContent += event.delta ?? "";
            break;
          case EventType.TEXT_MESSAGE_END:
            break;
          case EventType.STATE_DELTA:
            if (Array.isArray(event.delta)) {
              try {
                const nextState = applyPatch<Partial<AgentState>>(
                  agentStateRef.current ?? {},
                  event.delta as Operation[],
                  true,
                  false
                );
                agentStateRef.current = nextState.newDocument;
              } catch (stateError) {
                logger.error("Failed to apply state delta", stateError);
              }
            }
            break;
          case EventType.STATE_SNAPSHOT:
            agentStateRef.current = event.snapshot as
              | Partial<AgentState>
              | undefined;
            break;
          case EventType.CUSTOM:
            if (event.name === "verification") {
              handleCustomVerification(event.value);
            }
            break;
          default:
            break;
        }
      };

      const processBuffer = () => {
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw.startsWith("data:")) continue;
          const payload = raw.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as AGUIEvent;
            handleAgentEvent(parsed);
          } catch (parseError) {
            logger.error("Failed to parse agent event", parseError, payload);
          }
        }
        flushPendingEvents();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }
        if (done) break;
      }

      buffer += decoder.decode();
      processBuffer();
      flushPendingEvents();

      if (!fullContent) {
        removeEventById(assistantEventId);
        streamingAssistantIdRef.current = null;
        return;
      }

      updateMessageEvent(assistantEventId, {
        content: fullContent,
        status: "completed",
      });

      // Track successful run
      track("agent_chat_run_succeeded", {
        props: {
          turn_number: turnNumber,
          response_length: fullContent.length,
        },
      });

      await delay(100);
    } catch (error) {
      const isAbort =
        error instanceof Error && error.name === "AbortError";
      removeEventById(assistantEventId);
      failActiveTools();

      if (isAbort) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unknown agent error";

      track("agent_chat_run_failed", {
        props: {
          turn_number: turnNumber,
          message: message.slice(0, 120),
        },
      });

      throw error;
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      streamingAssistantIdRef.current = null;
    }
  };

  const clearChat = () => {
    track("agent_chat_cleared", {
      props: {
        had_events: events.length > 0,
      },
    });

    dispatchEvents({ type: "set_all", events: [] });
    setError(null);
    setCurrentTurn(0);
    agentStateRef.current = undefined;
    streamingAssistantIdRef.current = null;
    sessionMetadataRef.current = null;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  };

  const requestClearChat = () => {
    setIsClearDialogOpen(true);
  };

  const handleClearConfirmed = () => {
    setIsClearDialogOpen(false);
    clearChat();
  };

  const handleNearBottomChange = (nearBottom: boolean) => {
    setIsAtBottom(nearBottom);
  };

  // Some quick-action streams can mark the assistant message complete before React renders,
  // so we only gate on the active assistant event rather than its transient status.
  const shouldShowTypingIndicator = Boolean(
    isLoading &&
      streamingAssistantIdRef.current &&
      events.some(
        (event) =>
          event.id === streamingAssistantIdRef.current &&
          event.kind === "message" &&
          event.role === "assistant"
      )
  );

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="flex-1 min-h-0">
        {chatError && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Run interrupted</p>
              <p className="text-xs text-red-700">{chatError}</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                track("agent_chat_retry_clicked", {
                  props: {
                    last_error: chatError ?? null,
                  },
                });
                if (lastUserMessageRef.current) {
                  handleSend(lastUserMessageRef.current);
                }
              }}
            >
              Retry
            </Button>
          </div>
        )}
        <ChatMessages
          events={events}
          isLoading={isLoading}
          isInitialized={isInitialized}
          showTypingIndicator={shouldShowTypingIndicator}
          welcomeMessage={welcomeMessage}
          model={model}
          markdown={markdown}
          isAtBottom={isAtBottom}
          onNearBottomChange={handleNearBottomChange}
          bottomOffset={inputHeight}
        />
      </div>

      <ChatInput
        onSend={handleSend}
        onClear={requestClearChat}
        isLoading={isLoading}
        error={error}
        placeholder={placeholder}
        canClear={events.length > 0}
        onHeightChange={setInputHeight}
        quickActions={quickActions}
      />
      <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Clear chat history?</DialogTitle>
            <DialogDescription>
              This will remove all messages from the session. The action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsClearDialogOpen(false)}
              size="sm"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearConfirmed} size="sm">
              Clear chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
