import { useEffect } from "react";
import { Chatbot } from "@/components/chat/Chatbot";
import type { ChatQuickAction } from "@/components/chat/ChatInput";

const chatQuickActions: ChatQuickAction[] = [
  { label: "Recent proposals", message: "list recent proposals" },
  { label: "Quick summary", message: "summarize the latest discussion" },
];

export default function ChatPage() {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-full">
          <Chatbot
            welcomeMessage="I can help you participate in the House of Stake."
            placeholder="Ask about proposals, policies, processes, etc."
            className="h-full"
            quickActions={chatQuickActions}
          />
        </div>
      </div>
    </div>
  );
}
