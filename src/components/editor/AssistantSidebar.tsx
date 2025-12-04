import { EvaluationPanel, type EvaluationPanelProps } from "@/components/editor/EvaluationPanel";
import { PublishBar, type PublishBarProps } from "@/components/editor/PublishBar";
import { ChatPane } from "@/components/editor/ChatPane";
import type { Message, ToolCallState } from "@/components/editor/ProposalEditor";

type ChatSidebarProps = {
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

type AssistantSidebarProps = {
  isPassing: boolean;
  evaluationPanelProps: EvaluationPanelProps;
  publishBarProps: PublishBarProps;
  chatProps: ChatSidebarProps;
};

export function AssistantSidebar({
  isPassing,
  evaluationPanelProps,
  publishBarProps,
  chatProps,
}: AssistantSidebarProps) {
  return (
    <div
      style={{
        position: "sticky",
        top: "0",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        maxHeight: "calc(100vh - 150px)",
      }}
    >
      {!isPassing ? <EvaluationPanel {...evaluationPanelProps} /> : <PublishBar {...publishBarProps} />}
      <ChatPane {...chatProps} />
    </div>
  );
}
