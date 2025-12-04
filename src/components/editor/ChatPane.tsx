import { SidebarChat } from "@/components/editor/SidebarChat";
import type { Message, ToolCallState } from "@/components/editor/ProposalEditor";

type ChatPaneProps = {
  currentStep: string | null;
  messages: Message[];
  currentMessage: Message | null;
  activeToolCalls: Map<string, ToolCallState>;
  isRunning: boolean;
  suggestions: string[];
  inputMessage: string;
  setInputMessage: (value: string) => void;
  sendMessage: (value: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
};

export function ChatPane({
  currentStep,
  messages,
  currentMessage,
  activeToolCalls,
  isRunning,
  suggestions,
  inputMessage,
  setInputMessage,
  sendMessage,
  messagesEndRef,
}: ChatPaneProps) {
  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        maxHeight: "calc(100vh - 150px)",
        overflow: "hidden",
      }}
    >
      <SidebarChat
        currentStep={currentStep}
        messages={messages}
        currentMessage={currentMessage}
        activeToolCalls={activeToolCalls}
        isRunning={isRunning}
        suggestions={suggestions}
        inputMessage={inputMessage}
        setInputMessage={setInputMessage}
        sendMessage={sendMessage}
        evaluationSlot={undefined}
      />
      <div ref={messagesEndRef} />
    </div>
  );
}
