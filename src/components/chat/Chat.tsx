import { AgentChatPanel, type AgentChatPanelProps } from "./AgentChatPanel";
import type { ChatQuickAction } from "./ChatInput";
import type { AgentUIEvent, MessageUIEvent } from "@/types/agent-ui";

const DEFAULT_AGENT_ID = process.env.NEXT_PUBLIC_AGENT_ID ?? "governance-delegate";

export interface ChatProps extends Omit<AgentChatPanelProps, "agentId"> {
  agentId?: string;
  welcomeMessage?: string;
  placeholder?: string;
  quickActions?: ChatQuickAction[];
  model?: string;
  trackingPath?: string;
}

export interface EventsState {
  byId: Record<string, AgentUIEvent>;
  order: string[];
}

export type EventsAction = { type: "mark_tools_failed" };

export const eventsReducer = (state: EventsState, action: EventsAction): EventsState => {
  if (action.type === "mark_tools_failed") {
    const next = { ...state, byId: { ...state.byId } };
    for (const key of Object.keys(next.byId)) {
      const event = next.byId[key];
      if (event.kind === "tool_call" && event.status === "running") {
        next.byId[key] = { ...event, status: "failed" };
      }
    }
    return next;
  }
  return state;
};

export interface ConversationEntry {
  role: "assistant" | "user" | "system";
  content: string;
}

export const selectConversationHistory = (state: EventsState): ConversationEntry[] => {
  return state.order
    .map((id) => state.byId[id])
    .filter((event): event is MessageUIEvent => Boolean(event && event.kind === "message"))
    .map((event) => {
      const normalizedRole =
        event.role === "developer"
          ? "system"
          : event.role === "tool"
            ? "assistant"
            : event.role;

      return {
        role: normalizedRole,
        content: event.content,
      };
    });
};

export const prepareEventsForPersistence = (events: AgentUIEvent[]): AgentUIEvent[] => {
  const byRecent = events.slice(-200);
  let serialized = JSON.stringify(byRecent);
  if (serialized.length <= 50 * 1024) {
    return byRecent;
  }
  let trimmed = [...byRecent];
  while (serialized.length > 50 * 1024 && trimmed.length > 1) {
    trimmed = trimmed.slice(Math.ceil(trimmed.length * 0.2));
    serialized = JSON.stringify(trimmed);
  }
  return trimmed;
};

export const Chat = ({
  agentId = DEFAULT_AGENT_ID,
  welcomeMessage,
  placeholder,
  quickActions,
  model,
  trackingPath,
  ...rest
}: ChatProps) => {
  void welcomeMessage;
  void placeholder;
  void quickActions;
  void model;
  void trackingPath;
  return <AgentChatPanel agentId={agentId} {...rest} />;
};
