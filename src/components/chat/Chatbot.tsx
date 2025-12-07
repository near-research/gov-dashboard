import { AgentChatPanel } from "./AgentChatPanel";
import type { ChatQuickAction } from "./ChatInput";

interface ChatbotProps {
  model?: string;
  className?: string;
  placeholder?: string;
  welcomeMessage?: string;
  quickActions?: ChatQuickAction[];
}

export const Chatbot = ({
  model = "openai/gpt-oss-120b",
  className = "",
  placeholder = "Ask me anything...",
  welcomeMessage = "Welcome to NEAR AI Assistant. How can I help you today?",
  quickActions = [],
}: ChatbotProps) => {
  return (
    <AgentChatPanel
      model={model}
      className={className}
      placeholder={placeholder}
      welcomeMessage={welcomeMessage}
      quickActions={quickActions}
      trackingPath="/chat"
    />
  );
};
