import { AgentChatPanel, type AgentChatPanelProps } from "./AgentChatPanel";
import type { ChatQuickAction } from "./ChatInput";

export interface ChatProps extends Omit<AgentChatPanelProps, "trackingPath"> {
  quickActions?: ChatQuickAction[];
}

export const Chat = ({
  quickActions = [],
  ...rest
}: ChatProps) => {
  return <AgentChatPanel quickActions={quickActions} trackingPath="/" {...rest} />;
};

export type { EventsState } from "./AgentChatPanel";
export {
  eventsReducer,
  prepareEventsForPersistence,
  selectConversationHistory,
} from "./AgentChatPanel";
