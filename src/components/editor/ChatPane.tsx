import { SidebarChat } from "@/components/editor/SidebarChat";
import type { ChatSidebarProps } from "@/components/editor/types";

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
  onEvaluate,
  evalLoading,
  evaluationError,
  isPassing,
}: ChatSidebarProps) {
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
        onEvaluate={onEvaluate}
        evalLoading={evalLoading}
        evaluationError={evaluationError}
        isPassing={isPassing}
      />
      <div ref={messagesEndRef} />
    </div>
  );
}
