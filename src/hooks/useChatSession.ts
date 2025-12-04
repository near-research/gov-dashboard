import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { delay, generateEventId, normalizeAgentEventPayload, convertAgentEventToUIEvent } from "@/lib/chat/utils";
import type {
  AgentEvent,
  MessageEvent,
  MessageProof,
} from "@/lib/chat/types";
import type { AgentUIEvent } from "@/types/agent-ui";
import type { VerificationMetadata } from "@/types/agui-events";
import type { RemoteProof } from "@/components/verification/VerificationProof";

interface UpdateMessageData {
  content?: string;
  messageId?: string;
  verification?: VerificationMetadata;
  proof?: MessageProof;
  remoteProof?: RemoteProof | null;
  status?: "in_progress" | "completed";
}

const SESSION_STORAGE_KEY = "chatbot_session_v1";

export interface UseChatSessionOptions {
  model: string;
}

export const useChatSession = ({ model }: UseChatSessionOptions) => {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const hasHydratedRef = useRef(false);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const conversationHistoryRef = useRef<
    Array<{ role: string; content: string }>
  >([]);
  const turnCounterRef = useRef(0);
  const activeTurnRef = useRef(0);

  const addEvent = useCallback((event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);
  }, []);

  const upsertEvent = useCallback((incoming: AgentEvent) => {
    setEvents((prev) => {
      const index = prev.findIndex((event) => event.id === incoming.id);
      if (index === -1) {
        return [...prev, incoming];
      }
      const updated = [...prev];
      const existing = updated[index];

      if (!existing || existing.kind !== incoming.kind) {
        updated[index] = incoming;
        return updated;
      }

      if (incoming.kind === "message" && existing.kind === "message") {
        updated[index] = { ...existing, ...incoming };
      } else if (
        incoming.kind === "tool_call" &&
        existing.kind === "tool_call"
      ) {
        updated[index] = { ...existing, ...incoming };
      } else if (
        incoming.kind === "tool_result" &&
        existing.kind === "tool_result"
      ) {
        updated[index] = { ...existing, ...incoming };
      } else if (incoming.kind === "status" && existing.kind === "status") {
        updated[index] = { ...existing, ...incoming };
      } else if (
        incoming.kind === "sub_agent" &&
        existing.kind === "sub_agent"
      ) {
        updated[index] = { ...existing, ...incoming };
      } else {
        updated[index] = incoming;
      }

      return updated;
    });
  }, []);

  const updateMessageEvent = useCallback(
    (id: string, data: UpdateMessageData) => {
      setEvents((prev) =>
        prev.map((event) => {
          if (event.id !== id || event.kind !== "message") {
            return event;
          }

          const next: MessageEvent = { ...event };

          if (data.content !== undefined) {
            next.content = data.content;
          }

          if (data.messageId !== undefined) {
            next.messageId = data.messageId;
          }

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

          if (data.status) {
            next.status = data.status;
          }

          if (!next.status) {
            next.status =
              next.role === "assistant" && !next.content
                ? "in_progress"
                : "completed";
          }

          return next;
        })
      );
    },
    []
  );

  const removeEventById = useCallback((id: string) => {
    setEvents((prev) => prev.filter((event) => event.id !== id));
  }, []);

  useEffect(() => {
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || hasHydratedRef.current) return;
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        events?: AgentEvent[];
        history?: Array<{ role: string; content: string }>;
      };

      if (Array.isArray(parsed?.history)) {
        conversationHistoryRef.current = parsed.history;
      }

      if (Array.isArray(parsed?.events)) {
        const hydratedEvents = parsed.events.map((event) => ({
          ...event,
          timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        }));
        setEvents(hydratedEvents);
        const lastTurn = hydratedEvents.reduce(
          (max, event) => Math.max(max, event.turnNumber ?? 0),
          0
        );
        turnCounterRef.current = Math.max(
          lastTurn,
          conversationHistoryRef.current.length
        );
        activeTurnRef.current = turnCounterRef.current;
      } else {
        turnCounterRef.current = conversationHistoryRef.current.length;
        activeTurnRef.current = turnCounterRef.current;
      }

      hasHydratedRef.current = true;
    } catch (error) {
      console.error("Failed to load cached chat session:", error);
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
    } catch (error) {
      console.warn("Failed to persist chat session:", error);
    }
  }, [events]);

  const fetchProofForMessage = useCallback(
    async (verificationId: string, eventId: string, proof: MessageProof) => {
      const syncVerificationSession = async () => {
        const callSessionEndpoint = async () => {
          const sessionResp = await fetch("/api/verification/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              verificationId,
              requestHash: proof.requestHash,
              responseHash: proof.responseHash,
            }),
          });
          if (!sessionResp.ok) {
            const text = await sessionResp.text();
            throw new Error(text || "Failed to register verification session");
          }
        };

        try {
          await callSessionEndpoint();
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to register verification session";
          if (!message.toLowerCase().includes("not registered")) {
            throw error instanceof Error ? error : new Error(message);
          }

          const registerResp = await fetch(
            "/api/verification/register-session",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ verificationId }),
            }
          );
          if (!registerResp.ok) {
            const text = await registerResp.text();
            throw new Error(text || "Failed to register verification session");
          }

          await callSessionEndpoint();
        }
      };

      try {
        await syncVerificationSession();
      } catch (sessionError) {
        console.error("Failed to register verification session:", sessionError);
        toast.error("Unable to register verification session", {
          description:
            sessionError instanceof Error
              ? sessionError.message
              : "Unknown session error",
        });
        return;
      }

      updateMessageEvent(eventId, {
        verification: {
          source: "near-ai-cloud",
          status: "pending",
          messageId: verificationId,
        },
      });

      const requestProof = async () => {
        const resp = await fetch("/api/verification/proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verificationId,
            model,
            requestHash: proof.requestHash,
            responseHash: proof.responseHash,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || "Failed to fetch verification proof");
        }
        return (await resp.json()) as RemoteProof;
      };

      try {
        let remoteProof: RemoteProof | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            remoteProof = await requestProof();
            break;
          } catch (attemptError) {
            const message =
              attemptError instanceof Error
                ? attemptError.message
                : "Failed to fetch verification proof";
            const needsSession =
              attempt === 0 &&
              message
                .toLowerCase()
                .includes("verification session not registered");
            if (needsSession) {
              await syncVerificationSession();
              continue;
            }
            throw attemptError;
          }
        }

        if (!remoteProof) {
          throw new Error("Failed to fetch verification proof");
        }

        updateMessageEvent(eventId, {
          verification: {
            source: "near-ai-cloud",
            status: "verified",
            messageId: verificationId,
          },
          remoteProof,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to fetch verification proof";
        console.error("Automatic proof fetch failed:", error);

        updateMessageEvent(eventId, {
          verification: {
            source: "near-ai-cloud",
            status: "failed",
            messageId: verificationId,
            error: message,
          },
        });

        toast.error("Unable to load verification proof", {
          description: message,
        });
      }
    },
    [model, updateMessageEvent]
  );

  const sendStreamingMessage = useCallback(
    async (userMessage: string) => {
      let fullContent = "";
      let messageId: string | undefined;
      const assistantEventId = generateEventId();
      const maxAttempts = 3;
      const baseBackoff = 750;
      const proofData: MessageProof = {};
      const currentTurnNumber =
        activeTurnRef.current || turnCounterRef.current || 0;

      streamingAssistantIdRef.current = assistantEventId;

      addEvent({
        kind: "message",
        id: assistantEventId,
        role: "assistant",
        content: "",
        status: "in_progress",
        turnNumber: currentTurnNumber,
        timestamp: new Date(),
      });

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

      const nearAiRequestBody = {
        model,
        messages: conversationHistoryRef.current,
        stream: true,
      };

      const nearAiRequestString = JSON.stringify(nearAiRequestBody);
      proofData.nonce = nonce;
      proofData.verificationId = verificationId;

      const proxyRequestBody = {
        ...nearAiRequestBody,
        verificationId,
        verificationNonce: nonce,
      };

      const requestPayload = JSON.stringify(proxyRequestBody);

      console.log("[verification] Sending request:", {
        verificationId,
        nonce,
        requestLength: nearAiRequestString.length,
        proxyRequestLength: requestPayload.length,
      });

      const streamOnce = async (skipChars: number) => {
        let rawResponseText = "";
        let buffer = "";
        const response = await fetch("/api/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: requestPayload,
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(
            `API Error: ${response.status} - ${
              errorData.error || errorData.message || response.statusText
            }`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("Response body is not readable");

        const decoder = new TextDecoder();
        let remainingSkip = skipChars;

        const handlePayload = (payload: Record<string, any>) => {
          const normalized = normalizeAgentEventPayload(payload);
          if (!normalized) return;
          if (normalized.kind === "message_delta") {
            if (!messageId && normalized.messageId) {
              messageId = normalized.messageId;
            }
            let chunk = normalized.contentChunk || "";

            if (remainingSkip > 0 && chunk.length > 0) {
              if (chunk.length <= remainingSkip) {
                remainingSkip -= chunk.length;
                chunk = "";
              } else {
                chunk = chunk.slice(remainingSkip);
                remainingSkip = 0;
              }
            }

            const updateData: UpdateMessageData = {};

            if (chunk) {
              fullContent += chunk;
              updateData.content = fullContent;
            }

            if (messageId || normalized.messageId) {
              updateData.messageId = messageId || normalized.messageId;
            }

            if (normalized.verification) {
              updateData.verification = {
                ...normalized.verification,
                messageId:
                  normalized.verification.messageId ||
                  messageId ||
                  normalized.messageId,
              };
            }

            if (normalized.proof) {
              Object.assign(proofData, normalized.proof);
              updateData.proof = {
                ...(updateData.proof ?? {}),
                ...normalized.proof,
              };
            }

            if (
              updateData.content !== undefined ||
              updateData.messageId !== undefined ||
              updateData.verification ||
              updateData.proof
            ) {
              updateData.status = "in_progress";
              updateMessageEvent(assistantEventId, updateData);
            }
            return;
          }

          const targetTurnNumber =
            normalized.turnNumber ??
            activeTurnRef.current ??
            turnCounterRef.current ??
            0;
          upsertEvent({ ...normalized, turnNumber: targetTurnNumber });
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          rawResponseText += chunk;
          let bufferContent = buffer + chunk;
          const lines = bufferContent.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);

              if (!data || data.trim() === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                handlePayload(parsed);
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }

        const finalChunk = decoder.decode();
        rawResponseText += finalChunk;
        buffer += finalChunk;

        console.log("[verification] Stream complete:", {
          verificationId,
          rawResponseLength: rawResponseText.length,
          rawResponsePreview: {
            first100: rawResponseText.substring(0, 100),
            last100: rawResponseText.substring(
              Math.max(0, rawResponseText.length - 100)
            ),
          },
          endsWithNewlines: rawResponseText.endsWith("\n\n"),
        });
      };

      try {
        let attempt = 0;
        while (attempt < maxAttempts) {
          try {
            await streamOnce(fullContent.length);
            break;
          } catch (error) {
            attempt += 1;
            if (attempt >= maxAttempts) {
              throw error;
            }

            addEvent({
              kind: "status",
              id: generateEventId(),
              label: "Reconnecting to NEAR AI Cloud",
              detail: `Attempt ${attempt + 1} of ${maxAttempts}`,
              level: "warning",
              turnNumber: activeTurnRef.current || turnCounterRef.current || 0,
              timestamp: new Date(),
            });

            await delay(baseBackoff * attempt);
          }
        }

        if (fullContent) {
          conversationHistoryRef.current.push({
            role: "assistant",
            content: fullContent,
          });
          updateMessageEvent(assistantEventId, { status: "completed" });
        } else {
          removeEventById(assistantEventId);
          return;
        }

        if (messageId) {
          fetchProofForMessage(messageId, assistantEventId, proofData);
        }
      } catch (error: unknown) {
        removeEventById(assistantEventId);
        throw error;
      } finally {
        streamingAssistantIdRef.current = null;
      }
    },
    [
      addEvent,
      fetchProofForMessage,
      removeEventById,
      updateMessageEvent,
      upsertEvent,
      model,
    ]
  );

  const handleSend = useCallback(
    async (message: string) => {
      const nextTurnNumber = turnCounterRef.current + 1;
      turnCounterRef.current = nextTurnNumber;
      activeTurnRef.current = nextTurnNumber;

      addEvent({
        kind: "message",
        id: generateEventId(),
        role: "user",
        content: message,
        status: "completed",
        turnNumber: nextTurnNumber,
        timestamp: new Date(),
      });
      conversationHistoryRef.current.push({ role: "user", content: message });

      setIsLoading(true);
      setError(null);

      try {
        await sendStreamingMessage(message);
      } catch (error: unknown) {
        const messageText =
          error instanceof Error ? error.message : "Failed to get response";
        setError(messageText);
      } finally {
        setIsLoading(false);
      }
    },
    [addEvent, sendStreamingMessage]
  );

  const clearChat = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm("Clear chat history?")) {
      return;
    }
    setEvents([]);
    conversationHistoryRef.current = [];
    setError(null);
    streamingAssistantIdRef.current = null;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  const shouldShowTypingIndicator = useMemo(
    () =>
      Boolean(
        isLoading &&
          streamingAssistantIdRef.current &&
          events.some(
            (event) =>
              event.id === streamingAssistantIdRef.current &&
              event.kind === "message" &&
              event.role === "assistant" &&
              event.content.length === 0
          )
      ),
    [events, isLoading]
  );

  const uiEvents = useMemo<AgentUIEvent[]>(
    () => events.map((event) => convertAgentEventToUIEvent(event)),
    [events]
  );

  return {
    events,
    isInitialized,
    isLoading,
    error,
    handleSend,
    clearChat,
    shouldShowTypingIndicator,
    uiEvents,
  };
};
