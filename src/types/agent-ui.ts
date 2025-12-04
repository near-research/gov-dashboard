import {
  EventType,
  type AGUIEvent,
  type MessageRole,
  type VerificationMetadata,
} from "@/types/agui-events";
import type { PartialExpectations } from "@/utils/attestation/expectations";
import type { RemoteProof } from "@/components/verification/VerificationProof";

export type ToolCallStatus = "pending" | "running" | "completed" | "failed";
export type StatusLevel = "info" | "success" | "warning" | "error";
export type SubAgentPhase = "spawned" | "running" | "completed" | "failed";

export interface MessageProof extends PartialExpectations {
  requestHash?: string;
  responseHash?: string;
  verificationId?: string;
  nonce?: string;
  stage?: "initial_reasoning" | "final_synthesis";
  messageId?: string;
}

interface BaseAgentUIEvent {
  id: string;
  kind: "message" | "tool_call" | "tool_result" | "status" | "sub_agent";
  timestamp: Date;
  turnNumber: number;
  rawEvents?: AGUIEvent[];
}

export interface MessageUIEvent extends BaseAgentUIEvent {
  kind: "message";
  role: MessageRole;
  content: string;
  status: "in_progress" | "completed";
  messageId?: string;
  verification?: VerificationMetadata;
  proof?: MessageProof;
  remoteProof?: RemoteProof | null;
}

export interface ToolCallUIEvent extends BaseAgentUIEvent {
  kind: "tool_call";
  toolCallId: string;
  toolName: string;
  input?: string;
  output?: string;
  status: ToolCallStatus;
}

export interface ToolResultUIEvent extends BaseAgentUIEvent {
  kind: "tool_result";
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  status: ToolCallStatus;
}

export interface StatusUIEvent extends BaseAgentUIEvent {
  kind: "status";
  label: string;
  detail?: string;
  level: StatusLevel;
}

export interface SubAgentUIEvent extends BaseAgentUIEvent {
  kind: "sub_agent";
  agentName: string;
  phase: SubAgentPhase;
  detail?: string;
}

export type AgentUIEvent =
  | MessageUIEvent
  | ToolCallUIEvent
  | ToolResultUIEvent
  | StatusUIEvent
  | SubAgentUIEvent;

export type DisplayRole = "user" | "assistant" | "system";

export interface DisplayRoleMeta {
  role: DisplayRole;
  label: string;
}

export const mapRoleToDisplayRoleMeta = (
  role: MessageRole
): DisplayRoleMeta => {
  if (role === "developer") {
    return { role: "system", label: "Developer" };
  }
  if (role === "tool") {
    return { role: "assistant", label: "Tool" };
  }
  if (role === "assistant") {
    return { role: "assistant", label: "Agent" };
  }
  if (role === "system") {
    return { role: "system", label: "System" };
  }
  return { role: "user", label: "You" };
};

export interface ReduceAguiEventsOptions {
  turnNumber?: number;
}

const generateUiEventId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const appendRawEvent = <T extends AgentUIEvent>(
  event: T,
  raw: AGUIEvent
): T => ({
  ...event,
  rawEvents: [...(event.rawEvents ?? []), raw],
});

const findLastIndex = <T>(
  list: T[],
  predicate: (value: T) => boolean
): number => {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i])) return i;
  }
  return -1;
};

const cloneTimestampedEvent = (
  event: AGUIEvent,
  fallback: Date = new Date()
) => (event.timestamp ? new Date(event.timestamp) : fallback);

const createMessageEvent = (
  turnNumber: number,
  timestamp: Date,
  raw: AGUIEvent,
  overrides: Partial<MessageUIEvent> = {}
): MessageUIEvent =>
  appendRawEvent(
    {
      id: generateUiEventId(),
      kind: "message",
      role: "assistant",
      content: "",
      status: "in_progress",
      turnNumber,
      timestamp,
      ...overrides,
    },
    raw
  );

const createToolCallEvent = (
  turnNumber: number,
  timestamp: Date,
  raw: AGUIEvent,
  toolCallId: string,
  toolCallName: string
): ToolCallUIEvent =>
  appendRawEvent(
    {
      id: toolCallId,
      kind: "tool_call",
      toolCallId,
      toolName: toolCallName,
      status: "pending",
      turnNumber,
      timestamp,
    },
    raw
  );

const createToolResultEvent = (
  turnNumber: number,
  timestamp: Date,
  raw: AGUIEvent,
  toolCallId?: string,
  toolCallName?: string,
  output?: unknown
): ToolResultUIEvent =>
  appendRawEvent(
    {
      id: `${toolCallId ?? generateUiEventId()}-result`,
      kind: "tool_result",
      toolCallId,
      toolName: toolCallName,
      output,
      status: "completed",
      turnNumber,
      timestamp,
    },
    raw
  );

const createStatusEvent = (
  turnNumber: number,
  timestamp: Date,
  raw: AGUIEvent,
  label: string,
  level: StatusLevel,
  detail?: string
): StatusUIEvent =>
  appendRawEvent(
    {
      id: generateUiEventId(),
      kind: "status",
      label,
      detail,
      level,
      turnNumber,
      timestamp,
    },
    raw
  );

export const reduceAguiEventsToUiEvents = (
  previousEvents: AgentUIEvent[],
  newEvent: AGUIEvent,
  options: ReduceAguiEventsOptions = {}
): AgentUIEvent[] => {
  const turnNumber = options.turnNumber ?? 0;
  const timestamp = cloneTimestampedEvent(newEvent);
  const nextEvents = [...previousEvents];
  let changed = false;

  const updateEventAt = <T extends AgentUIEvent>(
    index: number,
    updater: (event: T) => T
  ) => {
    const existing = nextEvents[index] as T;
    const updated = appendRawEvent<T>(updater(existing), newEvent);
    nextEvents[index] = updated;
    changed = true;
    return updated;
  };

  const findMessageIndexById = (messageId?: string) =>
    messageId
      ? nextEvents.findIndex(
          (event) =>
            event.kind === "message" &&
            (event as MessageUIEvent).messageId === messageId
        )
      : -1;

  const findOpenAssistantMessageIndex = () =>
    findLastIndex(
      nextEvents,
      (event) =>
        event.kind === "message" &&
        (event as MessageUIEvent).role === "assistant" &&
        (event as MessageUIEvent).status === "in_progress"
    );

  const ensureMessageEventIndex = (messageId?: string) => {
    const byIdIndex = findMessageIndexById(messageId);
    if (byIdIndex !== -1) return byIdIndex;
    const openAssistantIndex = findOpenAssistantMessageIndex();
    if (openAssistantIndex !== -1) return openAssistantIndex;
    const newEventIndex = nextEvents.length;
    nextEvents.push(
      createMessageEvent(turnNumber, timestamp, newEvent, {
        messageId,
      })
    );
    changed = true;
    return newEventIndex;
  };

  const findToolCallIndex = (toolCallId: string) =>
    nextEvents.findIndex(
      (event) =>
        event.kind === "tool_call" &&
        event.id === toolCallId &&
        event.turnNumber === turnNumber
    );

  const updateToolCallStatus = (
    toolCallId: string,
    updater: (event: ToolCallUIEvent) => ToolCallUIEvent
  ) => {
    const index = findToolCallIndex(toolCallId);
    if (index === -1) {
      const created = createToolCallEvent(
        turnNumber,
        timestamp,
        newEvent,
        toolCallId,
        "Tool call"
      );
      nextEvents.push(created);
      changed = true;
      return;
    }
    updateEventAt<ToolCallUIEvent>(index, updater);
  };

  switch (newEvent.type) {
    case EventType.TEXT_MESSAGE_START: {
      const index = ensureMessageEventIndex(newEvent.messageId);
      updateEventAt<MessageUIEvent>(index, (existing) => ({
        ...existing,
        role: newEvent.role ?? "assistant",
        messageId: newEvent.messageId ?? existing.messageId,
        timestamp,
      }));
      break;
    }
    case EventType.TEXT_MESSAGE_CONTENT: {
      const index = ensureMessageEventIndex(newEvent.messageId);
      updateEventAt<MessageUIEvent>(index, (existing) => ({
        ...existing,
        messageId: newEvent.messageId ?? existing.messageId,
        content: `${existing.content}${newEvent.delta ?? ""}`,
        status: "in_progress",
        timestamp,
      }));
      break;
    }
    case EventType.TEXT_MESSAGE_END: {
      const index = ensureMessageEventIndex(newEvent.messageId);
      updateEventAt<MessageUIEvent>(index, (existing) => ({
        ...existing,
        messageId: newEvent.messageId ?? existing.messageId,
        status: "completed",
        timestamp,
      }));
      break;
    }
    case EventType.TEXT_MESSAGE_CHUNK: {
      const index = ensureMessageEventIndex(newEvent.messageId);
      updateEventAt<MessageUIEvent>(index, (existing) => ({
        ...existing,
        role: newEvent.role ?? existing.role ?? "assistant",
        messageId: newEvent.messageId ?? existing.messageId,
        content: `${existing.content}${newEvent.delta ?? ""}`,
        status: "completed",
        timestamp,
      }));
      break;
    }
    case EventType.TOOL_CALL_START: {
      const existingIndex = findToolCallIndex(newEvent.toolCallId);
      const toolCall = createToolCallEvent(
        turnNumber,
        timestamp,
        newEvent,
        newEvent.toolCallId,
        newEvent.toolCallName
      );
      if (existingIndex === -1) {
        nextEvents.push(toolCall);
      } else {
        nextEvents[existingIndex] = toolCall;
      }
      changed = true;
      break;
    }
    case EventType.TOOL_CALL_ARGS: {
      updateToolCallStatus(newEvent.toolCallId, (existing) => ({
        ...existing,
        toolName: existing.toolName,
        input: `${existing.input ?? ""}${newEvent.delta ?? ""}`,
        status: "running",
        timestamp,
      }));
      break;
    }
    case EventType.TOOL_CALL_END: {
      updateToolCallStatus(newEvent.toolCallId, (existing) => ({
        ...existing,
        status: existing.status === "failed" ? "failed" : "completed",
        timestamp,
      }));
      break;
    }
    case EventType.TOOL_CALL_RESULT: {
      const normalizedOutput =
        typeof newEvent.content === "string" ? newEvent.content : undefined;
      updateToolCallStatus(
        newEvent.toolCallId ?? generateUiEventId(),
        (existing) => ({
          ...existing,
          toolName: newEvent.toolCallName ?? existing.toolName,
          input: existing.input,
          output: normalizedOutput ?? existing.output,
          status: "completed",
          timestamp,
        })
      );
      nextEvents.push(
        createToolResultEvent(
          turnNumber,
          timestamp,
          newEvent,
          newEvent.toolCallId,
          newEvent.toolCallName,
          newEvent.content
        )
      );
      changed = true;
      break;
    }
    case EventType.RUN_STARTED:
      nextEvents.push(
        createStatusEvent(
          turnNumber,
          timestamp,
          newEvent,
          "Agent run started",
          "info"
        )
      );
      changed = true;
      break;
    case EventType.RUN_FINISHED:
      nextEvents.push(
        createStatusEvent(
          turnNumber,
          timestamp,
          newEvent,
          "Agent run finished",
          "success"
        )
      );
      changed = true;
      break;
    case EventType.RUN_ERROR:
      nextEvents.push(
        createStatusEvent(
          turnNumber,
          timestamp,
          newEvent,
          newEvent.message || "Agent run error",
          "error",
          newEvent.code
        )
      );
      changed = true;
      break;
    case EventType.STEP_STARTED:
      nextEvents.push(
        createStatusEvent(
          turnNumber,
          timestamp,
          newEvent,
          `Step started: ${newEvent.stepName}`,
          "info"
        )
      );
      changed = true;
      break;
    case EventType.STEP_FINISHED:
      nextEvents.push(
        createStatusEvent(
          turnNumber,
          timestamp,
          newEvent,
          `Step finished: ${newEvent.stepName}`,
          "success"
        )
      );
      changed = true;
      break;
    default:
      break;
  }

  if (!changed) {
    return previousEvents;
  }
  return nextEvents;
};
