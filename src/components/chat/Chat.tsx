// components/chat/Chat.tsx
import { useState, useRef, useEffect, useMemo } from "react";
import MarkdownIt from "markdown-it";
import { toast } from "sonner";
import { applyPatch, type Operation } from "fast-json-patch";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import {
  EventType,
  type AGUIEvent,
  type ProposalAgentState,
  type VerificationMetadata,
} from "@/types/agui-events";
import type { RemoteProof } from "@/components/verification/VerificationProof";
import type { PartialExpectations } from "@/utils/attestation-expectations";
import { AGENT_MODEL, buildProposalAgentRequest } from "@/utils/agent-tools";

type AgentRole = "user" | "assistant" | "system";
type ToolCallStatus = "pending" | "running" | "completed" | "failed";
type StatusLevel = "info" | "success" | "warning" | "error";

interface BaseAgentEvent {
  id: string;
  kind: "message" | "tool_call" | "tool_result" | "status" | "sub_agent";
  timestamp: Date;
}

interface MessageProof extends PartialExpectations {
  requestHash?: string;
  responseHash?: string;
  verificationId?: string;
  nonce?: string;
}

interface MessageEvent extends BaseAgentEvent {
  kind: "message";
  role: AgentRole;
  content: string;
  messageId?: string;
  verification?: VerificationMetadata;
  proof?: MessageProof;
  remoteProof?: RemoteProof | null;
}

interface ToolCallEvent extends BaseAgentEvent {
  kind: "tool_call";
  toolName: string;
  input?: unknown;
  status: ToolCallStatus;
}

interface ToolResultEvent extends BaseAgentEvent {
  kind: "tool_result";
  toolName: string;
  output?: unknown;
  status: ToolCallStatus;
}

interface StatusEvent extends BaseAgentEvent {
  kind: "status";
  label: string;
  detail?: string;
  level: StatusLevel;
}

type AgentEvent = MessageEvent | ToolCallEvent | ToolResultEvent | StatusEvent;

interface ChatProps {
  model?: string;
  className?: string;
  placeholder?: string;
  welcomeMessage?: string;
  state?: Partial<ProposalAgentState>;
  threadId?: string;
  runId?: string;
}

const generateEventId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const SESSION_STORAGE_KEY = "agent_chat_session_v1";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const textEncoder =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

const hashString = async (value: string) => {
  if (typeof window === "undefined" || !window.crypto?.subtle || !textEncoder) {
    return "";
  }

  const data = textEncoder.encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const Chat = ({
  model = AGENT_MODEL,
  className = "",
  placeholder = "Ask me anything about NEAR proposals…",
  welcomeMessage = "Welcome to the NEAR AI proposal agent.",
  state,
  threadId,
  runId,
}: ChatProps) => {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [inputHeight, setInputHeight] = useState(220);

  const conversationHistoryRef = useRef<
    Array<{ role: AgentRole; content: string }>
  >([]);
  const agentStateRef = useRef<Partial<ProposalAgentState> | undefined>(state);
  const hasHydratedRef = useRef(false);
  const streamingAssistantIdRef = useRef<string | null>(null);

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
        events?: AgentEvent[];
        history?: Array<{ role: AgentRole; content: string }>;
      };
      if (Array.isArray(parsed?.history)) {
        conversationHistoryRef.current = parsed.history;
      }
      if (Array.isArray(parsed?.events)) {
        setEvents(
          parsed.events.map((event) => ({
            ...event,
            timestamp: new Date(event.timestamp),
          }))
        );
      }
      hasHydratedRef.current = true;
    } catch (hydrationError) {
      console.error("Failed to hydrate agent chat", hydrationError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          events,
          history: conversationHistoryRef.current,
        })
      );
    } catch (persistError) {
      console.warn("Unable to persist agent chat session", persistError);
    }
  }, [events]);

  useEffect(() => {
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    agentStateRef.current = state;
  }, [state]);

  const addEvent = (event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);
  };

  const upsertEvent = (incoming: AgentEvent) => {
    setEvents((prev) => {
      const index = prev.findIndex((event) => event.id === incoming.id);
      if (index === -1) {
        return [...prev, incoming];
      }
      const next = [...prev];
      const existing = next[index];
      const merged = { ...existing, ...incoming } as AgentEvent;

      if ("proof" in existing || "proof" in (incoming as any)) {
        (merged as any).proof =
          (incoming as any).proof ?? (existing as any).proof;
      }

      if ("remoteProof" in existing || "remoteProof" in (incoming as any)) {
        (merged as any).remoteProof =
          (incoming as any).remoteProof ?? (existing as any).remoteProof;
      }

      next[index] = merged;
      return next;
    });
  };

  interface UpdateMessageData {
    content?: string;
    messageId?: string;
    verification?: VerificationMetadata;
    proof?: MessageProof;
    remoteProof?: RemoteProof | null;
  }

  const updateMessageEvent = (id: string, data: UpdateMessageData) => {
    setEvents((prev) =>
      prev.map((event) => {
        if (event.id !== id || event.kind !== "message") return event;
        const next: MessageEvent = { ...event };
        if (data.content !== undefined) next.content = data.content;
        if (data.messageId !== undefined) next.messageId = data.messageId;
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
        if (data.remoteProof !== undefined) {
          next.remoteProof = data.remoteProof;
        }
        return next;
      })
    );
  };

  const removeEventById = (id: string) => {
    setEvents((prev) => prev.filter((event) => event.id !== id));
  };

  const fetchProofForMessage = async (
    verificationId: string,
    eventId: string,
    proof: MessageProof
  ) => {
    updateMessageEvent(eventId, {
      verification: {
        source: "near-ai-cloud",
        status: "pending",
        messageId: verificationId,
      },
    });

    try {
      console.log("[verification] Fetching proof:", {
        verificationId,
        requestHash: proof.requestHash,
        responseHash: proof.responseHash,
        nonce: proof.nonce,
      });

      const response = await fetch("/api/verification/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationId,
          model,
          requestHash: proof.requestHash,
          responseHash: proof.responseHash,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to fetch verification proof");
      }

      const data = (await response.json()) as RemoteProof;

      console.log("[verification] Raw proof data received:", {
        hasSignature: !!data.signature,
        signatureType: typeof data.signature,
        signatureKeys: data.signature ? Object.keys(data.signature) : [],
        hasAttestation: !!data.attestation,
        hasNras: !!data.nras,
      });

      console.log("[verification] Proof fetched successfully:", {
        verified: data.results?.verified,
        nonceCheck: data.nonceCheck,
      });

      updateMessageEvent(eventId, {
        verification: {
          source: "near-ai-cloud",
          status: "verified",
          messageId: verificationId,
        },
        remoteProof: data,
      });
    } catch (error) {
      console.error("Automatic proof fetch failed:", error);
      updateMessageEvent(eventId, {
        verification: {
          source: "near-ai-cloud",
          status: "failed",
          messageId: verificationId,
        },
      });
    }
  };

  const handleSend = async (message: string) => {
    addEvent({
      kind: "message",
      id: generateEventId(),
      role: "user",
      content: message,
      timestamp: new Date(),
    });

    conversationHistoryRef.current.push({
      role: "user",
      content: message,
    });

    setIsLoading(true);
    setError(null);

    try {
      await sendStreamingMessage();
    } catch (sendError) {
      const messageText =
        sendError instanceof Error
          ? sendError.message
          : "Failed to get response";
      setError(messageText);
      toast.error("Agent error", { description: messageText });
    } finally {
      setIsLoading(false);
    }
  };

  const sendStreamingMessage = async () => {
    const assistantEventId = generateEventId();
    let fullContent = "";
    const proofData: MessageProof = {};
    let remoteMessageId: string | undefined;
    let proofRequested = false;
    const messagesSnapshot = [...conversationHistoryRef.current];
    const toolCallBuffers = new Map<string, string>();
    const toolCallMeta = new Map<string, { name?: string }>();

    streamingAssistantIdRef.current = assistantEventId;

    addEvent({
      kind: "message",
      id: assistantEventId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    });

    try {
      const verificationId = `chatcmpl-${crypto.randomUUID()}`;
      const sessionResp = await fetch("/api/verification/register-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId }),
      });
      if (!sessionResp.ok) {
        throw new Error("Failed to register verification session");
      }
      const { nonce } = await sessionResp.json();

      const { requestBody } = buildProposalAgentRequest({
        messages: messagesSnapshot,
        state: agentStateRef.current,
        model,
      });
      const requestBodyString = JSON.stringify(requestBody);

      proofData.requestHash = await hashString(requestBodyString);
      proofData.nonce = nonce;
      proofData.verificationId = verificationId;

      updateMessageEvent(assistantEventId, {
        proof: { ...proofData },
        verification: {
          source: "near-ai-cloud",
          status: "pending",
          messageId: verificationId,
        },
      });

      const bodyPayload = JSON.stringify({
        messages: messagesSnapshot,
        state: agentStateRef.current,
        threadId,
        runId,
        verificationId,
        verificationNonce: nonce,
      });

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyPayload,
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

      const maybeRequestProof = async () => {
        if (
          proofRequested ||
          !remoteMessageId ||
          !proofData.requestHash ||
          !proofData.responseHash
        ) {
          return;
        }
        proofRequested = true;
        await delay(2000);
        fetchProofForMessage(remoteMessageId, assistantEventId, {
          ...proofData,
        });
      };

      const handleCustomVerification = (value: any) => {
        if (!value || typeof value !== "object") return;
        if (typeof value.messageId === "string") {
          remoteMessageId = value.messageId;
        }
        if (typeof value.requestHash === "string") {
          proofData.requestHash = value.requestHash;
        }
        if (typeof value.responseHash === "string") {
          proofData.responseHash = value.responseHash;
        }
        if (typeof value.nonce === "string" && !proofData.nonce) {
          proofData.nonce = value.nonce;
        }
        updateMessageEvent(assistantEventId, { proof: { ...proofData } });
        maybeRequestProof();
      };

      const handleToolCall = (
        toolCallId: string,
        toolName?: string,
        delta?: string
      ) => {
        const existing = toolCallBuffers.get(toolCallId) || "";
        const nextPayload = delta ? existing + delta : existing;
        toolCallBuffers.set(toolCallId, nextPayload);
        const resolvedName =
          toolName ?? toolCallMeta.get(toolCallId)?.name ?? "Tool call";
        upsertEvent({
          kind: "tool_call",
          id: toolCallId,
          toolName: resolvedName,
          input: nextPayload,
          status: "running",
          timestamp: new Date(),
        });
      };

      const completeToolCall = (toolCallId: string) => {
        upsertEvent({
          kind: "tool_call",
          id: toolCallId,
          toolName: toolCallMeta.get(toolCallId)?.name || "Tool call",
          input: toolCallBuffers.get(toolCallId),
          status: "completed",
          timestamp: new Date(),
        });
      };

      const handleAgentEvent = (event: AGUIEvent) => {
        const eventTimestamp = event.timestamp
          ? new Date(event.timestamp)
          : new Date();
        switch (event.type) {
          case EventType.RUN_STARTED:
            addEvent({
              kind: "status",
              id: generateEventId(),
              label: "Agent run started",
              level: "info",
              timestamp: eventTimestamp,
            });
            break;
          case EventType.RUN_FINISHED:
            addEvent({
              kind: "status",
              id: generateEventId(),
              label: "Agent run finished",
              level: "success",
              timestamp: eventTimestamp,
            });
            break;
          case EventType.RUN_ERROR:
            addEvent({
              kind: "status",
              id: generateEventId(),
              label: event.message || "Agent run error",
              detail: event.code,
              level: "error",
              timestamp: eventTimestamp,
            });
            setError(event.message || "Agent run failed");
            break;
          case EventType.STEP_STARTED:
            addEvent({
              kind: "status",
              id: generateEventId(),
              label: `Step started: ${event.stepName}`,
              level: "info",
              timestamp: eventTimestamp,
            });
            break;
          case EventType.STEP_FINISHED:
            addEvent({
              kind: "status",
              id: generateEventId(),
              label: `Step finished: ${event.stepName}`,
              level: "success",
              timestamp: eventTimestamp,
            });
            break;
          case EventType.TEXT_MESSAGE_CONTENT: {
            if (event.messageId) {
              remoteMessageId = event.messageId;
              console.log(
                "[Chat] Captured messageId from TEXT_MESSAGE_CONTENT:",
                remoteMessageId
              );
            }
            fullContent += event.delta ?? "";
            updateMessageEvent(assistantEventId, {
              content: fullContent,
              messageId: remoteMessageId ?? event.messageId,
            });
            break;
          }
          case EventType.TEXT_MESSAGE_END:
            if (event.messageId) {
              remoteMessageId = event.messageId;
            }
            updateMessageEvent(assistantEventId, {
              messageId: remoteMessageId ?? event.messageId,
            });
            void maybeRequestProof();
            break;
          case EventType.TOOL_CALL_START:
            toolCallMeta.set(event.toolCallId, { name: event.toolCallName });
            handleToolCall(event.toolCallId, event.toolCallName, undefined);
            break;
          case EventType.TOOL_CALL_ARGS:
            handleToolCall(
              event.toolCallId,
              toolCallMeta.get(event.toolCallId)?.name,
              event.delta
            );
            break;
          case EventType.TOOL_CALL_END:
            completeToolCall(event.toolCallId);
            break;
          case EventType.TOOL_CALL_RESULT: {
            const resultEventId = event.toolCallId
              ? `${event.toolCallId}-result`
              : generateEventId();
            toolCallMeta.set(event.toolCallId, {
              name:
                event.toolCallName ?? toolCallMeta.get(event.toolCallId)?.name,
            });
            addEvent({
              kind: "tool_result",
              id: resultEventId,
              toolName:
                event.toolCallName ||
                toolCallMeta.get(event.toolCallId || "")?.name ||
                "Tool result",
              output: event.content,
              status: "completed",
              timestamp: eventTimestamp,
            });
            break;
          }
          case EventType.STATE_DELTA:
            if (Array.isArray(event.delta)) {
              try {
                const nextState = applyPatch<Partial<ProposalAgentState>>(
                  agentStateRef.current ?? {},
                  event.delta as Operation[],
                  false,
                  false
                );
                agentStateRef.current = nextState.newDocument;
              } catch (stateError) {
                console.error("Failed to apply state delta", stateError);
              }
            }
            break;
          case EventType.STATE_SNAPSHOT:
            agentStateRef.current = event.snapshot as
              | Partial<ProposalAgentState>
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
            console.error("Failed to parse agent event", parseError, payload);
          }
        }
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

      if (fullContent) {
        conversationHistoryRef.current.push({
          role: "assistant",
          content: fullContent,
        });
      } else {
        removeEventById(assistantEventId);
        streamingAssistantIdRef.current = null;
        return;
      }

      await delay(100);

      await maybeRequestProof();
    } catch (error) {
      removeEventById(assistantEventId);
      throw error;
    } finally {
      streamingAssistantIdRef.current = null;
    }
  };

  const clearChat = () => {
    if (window.confirm("Clear chat history?")) {
      setEvents([]);
      conversationHistoryRef.current = [];
      setError(null);
      streamingAssistantIdRef.current = null;
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  };

  const handleNearBottomChange = (nearBottom: boolean) => {
    setIsAtBottom(nearBottom);
  };

  const shouldShowTypingIndicator = Boolean(
    isLoading &&
      streamingAssistantIdRef.current &&
      events.some(
        (event) =>
          event.id === streamingAssistantIdRef.current &&
          event.kind === "message" &&
          event.role === "assistant" &&
          event.content.length === 0
      )
  );

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="flex-1 min-h-0">
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
        onClear={clearChat}
        isLoading={isLoading}
        error={error}
        placeholder={placeholder}
        canClear={events.length > 0}
        onHeightChange={setInputHeight}
      />
    </div>
  );
};
