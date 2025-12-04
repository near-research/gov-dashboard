// components/chat/Chatbot.tsx
import { useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { useChatSession } from "@/hooks/useChatSession";

interface ChatbotProps {
  model?: string;
  className?: string;
  placeholder?: string;
  welcomeMessage?: string;
}

export const Chatbot = ({
  model = "openai/gpt-oss-120b",
  className = "",
  placeholder = "Ask me anything...",
  welcomeMessage = "Welcome to NEAR AI Assistant. How can I help you today?",
}: ChatbotProps) => {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [inputHeight, setInputHeight] = useState(220);

  const markdown = useMemo(
    () =>
      new MarkdownIt({
        html: false,
        linkify: true,
        breaks: true,
      }),
    []
  );

  const {
    events,
    uiEvents,
    handleSend,
    clearChat,
    isInitialized,
    isLoading,
    shouldShowTypingIndicator,
    error,
  } = useChatSession({ model });

  const handleNearBottomChange = (nearBottom: boolean) => {
    setIsAtBottom(nearBottom);
  };

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="flex-1 min-h-0">
        <ChatMessages
          events={uiEvents}
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
