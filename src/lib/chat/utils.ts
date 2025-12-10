import { extractVerificationMetadata } from "@/verification/normalize";
import { extractExpectationsFromMessage } from "@/utils/attestation/expectations";
import type { PartialExpectations } from "@/types/verification";
import type { AgentUIEvent } from "@/types/agent-ui";
import type {
  AgentEvent,
  AgentRole,
  MessageDelta,
  MessageProof,
  StatusLevel,
  SubAgentPhase,
  ToolCallStatus,
} from "./types";

export const generateEventId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const toTimestamp = (value?: string | number) =>
  value ? new Date(value) : new Date();

export const toToolStatus = (status?: string): ToolCallStatus => {
  switch (status) {
    case "pending":
    case "running":
    case "completed":
    case "failed":
      return status;
    default:
      return "running";
  }
};

export const toStatusLevel = (level?: string): StatusLevel => {
  switch (level) {
    case "success":
    case "warning":
    case "error":
      return level;
    default:
      return "info";
  }
};

export const toSubAgentPhase = (phase?: string): SubAgentPhase => {
  switch (phase) {
    case "spawned":
    case "running":
    case "completed":
    case "failed":
      return phase;
    default:
      return "spawned";
  }
};

export const extractText = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).join("");
  }
  if (typeof value === "object") {
    if (
      "text" in value &&
      typeof (value as { text?: unknown }).text === "string"
    ) {
      return (value as { text: string }).text;
    }
    if ("content" in value) {
      return extractText((value as { content?: unknown }).content);
    }
  }
  return "";
};

export const serializeToolInput = (input?: unknown): string | undefined => {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
};

const assertNever = (value: never): never => {
  throw new Error(`Unhandled agent event: ${JSON.stringify(value)}`);
};

export const convertAgentEventToUIEvent = (
  event: AgentEvent
): AgentUIEvent => {
  const turnNumber = event.turnNumber ?? 0;
  const timestamp =
    event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);

  switch (event.kind) {
    case "message": {
      const status =
        event.status ??
        (event.role === "assistant" && !event.content
          ? "in_progress"
          : "completed");

      return {
        id: event.id,
        kind: "message",
        role: event.role,
        content: event.content,
        status,
        messageId: event.messageId,
        verification: event.verification,
        proof: event.proof,
        remoteProof: event.remoteProof ?? null,
        turnNumber,
        timestamp,
      };
    }
    case "tool_call":
      return {
        id: event.id,
        kind: "tool_call",
        toolCallId: event.id,
        toolName: event.toolName,
        input: serializeToolInput(event.input),
        status: event.status ?? "pending",
        turnNumber,
        timestamp,
      };
    case "tool_result":
      return {
        id: event.id,
        kind: "tool_result",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: event.output,
        status: event.status ?? "completed",
        turnNumber,
        timestamp,
      };
    case "status":
      return {
        id: event.id,
        kind: "status",
        label: event.label,
        detail: event.detail,
        level: event.level ?? "info",
        turnNumber,
        timestamp,
      };
    case "sub_agent":
      return {
        id: event.id,
        kind: "sub_agent",
        agentName: event.agentName,
        phase: event.phase,
        detail: event.detail,
        turnNumber,
        timestamp,
      };
  }
  return assertNever(event);
};

const extractProofFields = (
  payload: Record<string, any>,
  envelope?: Record<string, any>
): MessageProof | undefined => {
  const expectations = extractExpectationsFromMessage({
    ...payload,
    envelope,
  });

  const requestHash =
    (payload.proof as any)?.requestHash ||
    (payload.data?.proof as any)?.requestHash ||
    (payload as any)?.requestHash ||
    (envelope as any)?.requestHash;
  const responseHash =
    (payload.proof as any)?.responseHash ||
    (payload.data?.proof as any)?.responseHash ||
    (payload as any)?.responseHash ||
    (envelope as any)?.responseHash;

  if (Object.keys(expectations).length || requestHash || responseHash) {
    return {
      ...expectations,
      requestHash,
      responseHash,
    };
  }
  return undefined;
};

export const normalizeAgentEventPayload = (
  payload: Record<string, any>
): AgentEvent | MessageDelta | null => {
  if (!payload || typeof payload !== "object") return null;

  const envelopeCandidates = [
    payload.event,
    payload.ag_event,
    payload.data?.event,
    payload.payload,
  ];

  const envelope = envelopeCandidates.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      ("type" in candidate || "kind" in candidate)
  ) as Record<string, any> | undefined;

  const eventType =
    envelope?.type || envelope?.kind || payload.event_type || payload.type;

  if (!eventType) {
    const content = payload.choices?.[0]?.delta?.content;
    if (content) {
      return {
        kind: "message_delta",
        contentChunk: extractText(content),
        messageId: payload.id,
      };
    }
    return null;
  }

  const timestamp = envelope?.timestamp || payload.timestamp || Date.now();

  switch (eventType) {
    case "message.delta":
    case "message":
    case "agent_output":
    case "assistant_message": {
      const content =
        envelope?.delta ??
        envelope?.content ??
        payload.delta ??
        payload.content ??
        payload.choices?.[0]?.delta?.content;

      if (!content) return null;

      const verification = extractVerificationMetadata(payload, envelope);
      const proof = extractProofFields(payload, envelope);

      return {
        kind: "message_delta",
        contentChunk: extractText(content),
        messageId:
          envelope?.id ?? envelope?.message_id ?? payload.id ?? undefined,
        role: (envelope?.role || payload.role || "assistant") as AgentRole,
        verification,
        proof,
      };
    }
    case "tool_call":
    case "tool-start":
    case "tool_call_started":
      return {
        kind: "tool_call",
        id: envelope?.id || payload.id || generateEventId(),
        toolName:
          envelope?.tool?.name ||
          envelope?.name ||
          envelope?.toolName ||
          "Tool call",
        input: envelope?.tool?.input || envelope?.input || envelope?.payload,
        status: toToolStatus(envelope?.status),
        timestamp: toTimestamp(timestamp),
      };
    case "tool_result":
    case "tool-finish":
    case "tool_call_completed":
    case "tool_call_result":
      return {
        kind: "tool_result",
        id: envelope?.id || payload.id || generateEventId(),
        toolName:
          envelope?.tool?.name ||
          envelope?.name ||
          envelope?.toolName ||
          "Tool result",
        toolCallId:
          envelope?.tool_call_id ||
          envelope?.toolCallId ||
          envelope?.tool_call?.id ||
          envelope?.parent_id,
        output:
          envelope?.tool?.output ||
          envelope?.output ||
          envelope?.result ||
          envelope?.data,
        status: toToolStatus(envelope?.status || "completed"),
        timestamp: toTimestamp(timestamp),
      };
    case "status":
    case "agent_status":
      return {
        kind: "status",
        id: envelope?.id || payload.id || generateEventId(),
        label:
          envelope?.label ||
          envelope?.title ||
          envelope?.status ||
          "Status update",
        detail: envelope?.detail || envelope?.message,
        level: toStatusLevel(envelope?.level),
        timestamp: toTimestamp(timestamp),
      };
    case "sub_agent":
    case "agent_lifecycle":
    case "agent_spawned":
      return {
        kind: "sub_agent",
        id: envelope?.id || payload.id || generateEventId(),
        agentName:
          envelope?.agent_name ||
          envelope?.agent ||
          envelope?.name ||
          "Sub-agent",
        phase: toSubAgentPhase(envelope?.phase || envelope?.status),
        detail: envelope?.detail || envelope?.message,
        timestamp: toTimestamp(timestamp),
      };
    default: {
      const content = payload.choices?.[0]?.delta?.content;
      if (content) {
        return {
          kind: "message_delta",
          contentChunk: extractText(content),
          messageId: payload.id,
        };
      }
      return null;
    }
  }
};
