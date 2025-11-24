/**
 * AG-UI Protocol Event Types
 * Based on Agent User Interaction Protocol specification
 * https://docs.agui.org
 */

// Verification Metadata
export type VerificationStatus = "pending" | "verified" | "failed";

export interface VerificationMetadata {
  source: "near-ai-cloud";
  status: VerificationStatus;
  messageId?: string;
  nonce?: string;
  attestationReport?: string;
  attestationUrl?: string;
  proof?: unknown;
  signature?: string;
  measurement?: string;
  issuedAt?: string | number;
  error?: string;
}

// Event Type Enum
export enum EventType {
  // Lifecycle Events
  RUN_STARTED = "RUN_STARTED",
  RUN_FINISHED = "RUN_FINISHED",
  RUN_ERROR = "RUN_ERROR",
  STEP_STARTED = "STEP_STARTED",
  STEP_FINISHED = "STEP_FINISHED",

  // Text Message Events
  TEXT_MESSAGE_START = "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END = "TEXT_MESSAGE_END",
  TEXT_MESSAGE_CHUNK = "TEXT_MESSAGE_CHUNK",

  // Tool Call Events
  TOOL_CALL_START = "TOOL_CALL_START",
  TOOL_CALL_ARGS = "TOOL_CALL_ARGS",
  TOOL_CALL_END = "TOOL_CALL_END",
  TOOL_CALL_RESULT = "TOOL_CALL_RESULT",

  // State Management Events
  STATE_SNAPSHOT = "STATE_SNAPSHOT",
  STATE_DELTA = "STATE_DELTA",
  MESSAGES_SNAPSHOT = "MESSAGES_SNAPSHOT",
  ACTIVITY_SNAPSHOT = "ACTIVITY_SNAPSHOT",
  ACTIVITY_DELTA = "ACTIVITY_DELTA",

  // Special Events
  RAW = "RAW",
  CUSTOM = "CUSTOM",
}

// Message Role Type
export type MessageRole =
  | "developer"
  | "system"
  | "assistant"
  | "user"
  | "tool";

// Base Event Interface
export interface BaseEvent {
  type: EventType;
  timestamp?: number;
  rawEvent?: unknown;
  verification?: VerificationMetadata;
}

// ============================================================================
// Lifecycle Events
// ============================================================================

/**
 * Signals the start of an agent run
 */
export interface RunStartedEvent extends BaseEvent {
  type: EventType.RUN_STARTED;
  threadId: string;
  runId: string;
  parentRunId?: string; // For branching/time travel
  input?: unknown; // The exact agent input for this run
}

/**
 * Signals the successful completion of an agent run
 */
export interface RunFinishedEvent extends BaseEvent {
  type: EventType.RUN_FINISHED;
  threadId: string;
  runId: string;
  result?: unknown;
  outcome?: "success" | "interrupt"; // For interrupt-aware workflows
  interrupt?: unknown; // Contains interrupt details when paused
}

/**
 * Signals an error during an agent run
 */
export interface RunErrorEvent extends BaseEvent {
  type: EventType.RUN_ERROR;
  message: string;
  code?: string;
}

/**
 * Signals the start of a step within an agent run
 */
export interface StepStartedEvent extends BaseEvent {
  type: EventType.STEP_STARTED;
  stepName: string;
}

/**
 * Signals the completion of a step within an agent run
 */
export interface StepFinishedEvent extends BaseEvent {
  type: EventType.STEP_FINISHED;
  stepName: string;
}

// ============================================================================
// Text Message Events
// ============================================================================

/**
 * Signals the start of a text message
 */
export interface TextMessageStartEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_START;
  messageId: string;
  role: "assistant";
}

/**
 * Represents a chunk of content in a streaming text message
 */
export interface TextMessageContentEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_CONTENT;
  messageId: string;
  delta: string; // Non-empty text content chunk
}

/**
 * Signals the end of a text message
 */
export interface TextMessageEndEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_END;
  messageId: string;
}

/**
 * A self-contained text message event (combines start, content, and end)
 */
export interface TextMessageChunkEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_CHUNK;
  messageId?: string;
  role?: MessageRole;
  delta?: string;
}

// ============================================================================
// Tool Call Events
// ============================================================================

/**
 * Signals the start of a tool call
 */
export interface ToolCallStartEvent extends BaseEvent {
  type: EventType.TOOL_CALL_START;
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string | null;
}

/**
 * Represents a chunk of argument data for a tool call
 */
export interface ToolCallArgsEvent extends BaseEvent {
  type: EventType.TOOL_CALL_ARGS;
  toolCallId: string;
  delta: string; // Argument data chunk (often JSON fragments)
}

/**
 * Signals the end of a tool call
 */
export interface ToolCallEndEvent extends BaseEvent {
  type: EventType.TOOL_CALL_END;
  toolCallId: string;
}

/**
 * Provides the result of a tool call execution
 */
export interface ToolCallResultEvent extends BaseEvent {
  type: EventType.TOOL_CALL_RESULT;
  messageId: string;
  toolCallId: string;
  content: string; // The actual result/output content
  toolCallName?: string;
  role?: "tool";
}

/**
 * Streams tool call data without explicit start/end events
 */
export interface ToolCallChunkEvent extends BaseEvent {
  type: EventType.TOOL_CALL_ARGS;
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  delta?: string;
}

// ============================================================================
// State Management Events
// ============================================================================

/**
 * JSON Patch Operation (RFC 6902)
 */
export interface JSONPatchOperation<TDocument = unknown> {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string; // For move/copy operations
}

/**
 * Provides a complete snapshot of an agent's state
 */
export interface StateSnapshotEvent<TSnapshot = unknown> extends BaseEvent {
  type: EventType.STATE_SNAPSHOT;
  snapshot: TSnapshot; // Complete state snapshot
}

/**
 * Provides a partial update to an agent's state using JSON Patch (RFC 6902)
 */
export interface StateDeltaEvent<TDocument = unknown> extends BaseEvent {
  type: EventType.STATE_DELTA;
  delta: JSONPatchOperation<TDocument>[]; // Array of JSON Patch operations
}

/**
 * Provides a snapshot of all messages in a conversation
 */
export interface MessagesSnapshotEvent extends BaseEvent {
  type: EventType.MESSAGES_SNAPSHOT;
  messages: Array<{
    id: string;
    role: MessageRole;
    content: string;
    [key: string]: unknown;
  }>;
}

/**
 * Delivers a complete snapshot of an activity message
 */
export interface ActivitySnapshotEvent extends BaseEvent {
  type: EventType.ACTIVITY_SNAPSHOT;
  messageId: string;
  activityType: string;
  content: Record<string, unknown>;
  replace?: boolean;
}

/**
 * Provides incremental updates to an activity snapshot using JSON Patch
 */
export interface ActivityDeltaEvent extends BaseEvent {
  type: EventType.ACTIVITY_DELTA;
  messageId: string;
  activityType: string;
  patch: JSONPatchOperation[];
}

// ============================================================================
// Special Events
// ============================================================================

/**
 * Used to pass through events from external systems
 */
export interface RawEvent extends BaseEvent {
  type: EventType.RAW;
  event: unknown; // Original event data
  source?: string; // Optional source identifier
}

/**
 * Used for application-specific custom events
 */
export interface CustomEvent extends BaseEvent {
  type: EventType.CUSTOM;
  name: string; // Name of the custom event
  value: unknown; // Value associated with the event
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union of all AG-UI event types
 */
export type AGUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | TextMessageChunkEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | MessagesSnapshotEvent
  | RawEvent
  | CustomEvent;

// ============================================================================
// Type Guards
// ============================================================================

export function isRunStartedEvent(event: AGUIEvent): event is RunStartedEvent {
  return event.type === EventType.RUN_STARTED;
}

export function isRunFinishedEvent(
  event: AGUIEvent
): event is RunFinishedEvent {
  return event.type === EventType.RUN_FINISHED;
}

export function isRunErrorEvent(event: AGUIEvent): event is RunErrorEvent {
  return event.type === EventType.RUN_ERROR;
}

export function isTextMessageContentEvent(
  event: AGUIEvent
): event is TextMessageContentEvent {
  return event.type === EventType.TEXT_MESSAGE_CONTENT;
}

export function isToolCallStartEvent(
  event: AGUIEvent
): event is ToolCallStartEvent {
  return event.type === EventType.TOOL_CALL_START;
}

export function isToolCallArgsEvent(
  event: AGUIEvent
): event is ToolCallArgsEvent {
  return event.type === EventType.TOOL_CALL_ARGS;
}

export function isStateDeltaEvent(event: AGUIEvent): event is StateDeltaEvent {
  return event.type === EventType.STATE_DELTA;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Options for running an agent
 */
export interface RunAgentInput {
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  messages: Array<{
    id?: string;
    role: MessageRole | "activity";
    content: string;
    name?: string;
  }>;
  state?: Record<string, unknown>;
  tools?: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
  context?: Array<{
    description: string;
    value: string;
  }>;
  forwardedProps?: Record<string, unknown>;
}

/**
 * Agent response type
 */
export interface AgentResponse {
  stream: ReadableStream<Uint8Array>;
}

export interface AgentState {
  title: string;
  content: string;
  evaluation: import("@/types/evaluation").Evaluation | null;
}

export type ToolChoice =
  | "auto"
  | {
      type: "function";
      function: { name: "write_proposal" | "screen_proposal" };
    };

export interface CompletionToolCall {
  id: string;
  type?: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface CompletionMessage {
  content?: string;
  tool_calls?: CompletionToolCall[];
}
