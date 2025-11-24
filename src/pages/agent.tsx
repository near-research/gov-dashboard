import { useEffect } from "react";
import { Chat } from "@/components/chat/Chat";
import { useGovernanceAnalytics } from "@/lib/analytics";

export default function AgentPage() {
  const track = useGovernanceAnalytics();

  useEffect(() => {
    track("agent_chat_opened", {
      props: { path: "/agent" },
    });

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-full">
          <Chat
            welcomeMessage="I can help you participate in the House of Stake."
            placeholder="Ask about proposals, policies, processes, etc."
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
