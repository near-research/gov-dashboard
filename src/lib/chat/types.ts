import type { PartialExpectations } from "@/utils/attestation/expectations";
import type { RemoteProof } from "@/components/verification/VerificationProof";
import type { VerificationMetadata } from "@/types/agui-events";

export type AgentRole = "user" | "assistant" | "system";
export type ToolCallStatus = "pending" | "running" | "completed" | "failed";
export type StatusLevel = "info" | "success" | "warning" | "error";
export type SubAgentPhase = "spawned" | "running" | "completed" | "failed";

export interface BaseAgentEvent {
  id: string;
  kind: "message" | "tool_call" | "tool_result" | "status" | "sub_agent";
  timestamp: Date;
  turnNumber?: number;
}

export interface MessageProof extends PartialExpectations {
  requestHash?: string;
  responseHash?: string;
  verificationId?: string;
  nonce?: string;
}

export interface MessageEvent extends BaseAgentEvent {
  kind: "message";
  role: AgentRole;
  content: string;
  status?: "in_progress" | "completed";
  messageId?: string;
  verification?: VerificationMetadata;
  proof?: MessageProof;
  remoteProof?: RemoteProof | null;
}

export interface ToolCallEvent extends BaseAgentEvent {
  kind: "tool_call";
  toolName: string;
  input?: unknown;
  status: ToolCallStatus;
  verification?: VerificationMetadata;
}

export interface ToolResultEvent extends BaseAgentEvent {
  kind: "tool_result";
  toolName: string;
  output?: unknown;
  status: ToolCallStatus;
  toolCallId?: string;
  messageId?: string;
  verification?: VerificationMetadata;
}

export interface StatusEvent extends BaseAgentEvent {
  kind: "status";
  label: string;
  detail?: string;
  level: StatusLevel;
}

export interface SubAgentEvent extends BaseAgentEvent {
  kind: "sub_agent";
  agentName: string;
  phase: SubAgentPhase;
  detail?: string;
}

export type AgentEvent =
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | StatusEvent
  | SubAgentEvent;

export interface MessageDelta {
  kind: "message_delta";
  contentChunk: string;
  messageId?: string;
  role?: AgentRole;
  verification?: VerificationMetadata;
  proof?: MessageProof;
}
