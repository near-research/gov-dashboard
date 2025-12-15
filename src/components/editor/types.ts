import type { RefObject } from "react";
import type { MessageRole, VerificationMetadata } from "@/types/agui-events";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  verification?: VerificationMetadata;
  remoteId?: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  args: string;
  status: "in_progress" | "completed";
  verification?: VerificationMetadata;
}

export type ChatSidebarProps = {
  currentStep: string | null;
  messages: Message[];
  currentMessage: Message | null;
  activeToolCalls: Map<string, ToolCallState>;
  isRunning: boolean;
  suggestions: string[];
  inputMessage: string;
  setInputMessage: (value: string) => void;
  sendMessage: (value: string) => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
};
