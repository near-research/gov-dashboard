// components/chat/ChatMessages.tsx
import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";
import { Message } from "./Message";
import { ToolMessage } from "./ToolMessage";
import { Status } from "./Status";
import { AgentMessage } from "./AgentMessage";
import type MarkdownIt from "markdown-it";
import type { VerificationMetadata } from "@/types/agui-events";
import type { PartialExpectations } from "@/utils/attestation-expectations";
import type { RemoteProof } from "@/components/verification/VerificationProof";

interface BaseAgentEvent {
  id: string;
  kind: "message" | "tool_call" | "tool_result" | "status" | "sub_agent";
  timestamp: Date;
}

interface MessageProof extends PartialExpectations {
  requestHash?: string;
  responseHash?: string;
}

interface MessageEvent extends BaseAgentEvent {
  kind: "message";
  role: "user" | "assistant" | "system";
  content: string;
  messageId?: string;
  verification?: VerificationMetadata;
  proof?: MessageProof;
  remoteProof?: RemoteProof | null;
}

interface ToolCallEvent extends BaseAgentEvent {
  kind: "tool_call";
  toolName: string;
  input?: unknown;
  status: "pending" | "running" | "completed" | "failed";
}

interface ToolResultEvent extends BaseAgentEvent {
  kind: "tool_result";
  toolName: string;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed";
}

interface StatusEvent extends BaseAgentEvent {
  kind: "status";
  label: string;
  detail?: string;
  level: "info" | "success" | "warning" | "error";
}

interface SubAgentEvent extends BaseAgentEvent {
  kind: "sub_agent";
  agentName: string;
  phase: "spawned" | "running" | "completed" | "failed";
  detail?: string;
}

type AgentEvent =
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | StatusEvent
  | SubAgentEvent;

interface ChatMessagesProps {
  events: AgentEvent[];
  isLoading: boolean;
  isInitialized: boolean;
  showTypingIndicator: boolean;
  welcomeMessage: string;
  model?: string;
  markdown: MarkdownIt;
  isAtBottom: boolean;
  onNearBottomChange: (nearBottom: boolean) => void;
  bottomOffset?: number;
}

const TypingIndicator = () => {
  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-2xl px-4 py-3 rounded-bl-sm">
        <div className="flex gap-1">
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0.2s]" />
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0.4s]" />
        </div>
      </div>
    </div>
  );
};

const ScrollToBottom = ({
  onClick,
  offset,
}: {
  onClick: () => void;
  offset: number;
}) => {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30"
      style={{ bottom: `${offset}px` }}
    >
      <div className="mx-auto flex w-full max-w-4xl justify-center px-4 sm:px-6">
        <Button
          variant="secondary"
          size="icon"
          className="pointer-events-auto rounded-full shadow-lg"
          onClick={onClick}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export const ChatMessages = ({
  events,
  isLoading,
  isInitialized,
  showTypingIndicator,
  welcomeMessage,
  model,
  markdown,
  isAtBottom,
  onNearBottomChange,
  bottomOffset = 220,
}: ChatMessagesProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const footerHeight = Math.max(bottomOffset, 160);
  const buttonOffset = footerHeight + 30;

  useEffect(() => {
    if (!scrollRef.current) return;

    if (isAtBottom) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

    const handleScroll = () => {
      if (!scrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const nearBottom = scrollHeight - (scrollTop + clientHeight) <= 120;
      onNearBottomChange(nearBottom);
    };

    const element = scrollRef.current;
    element.addEventListener("scroll", handleScroll);
    handleScroll();

    return () => element.removeEventListener("scroll", handleScroll);
  }, [events, isAtBottom, onNearBottomChange]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const renderEvent = (event: AgentEvent) => {
    switch (event.kind) {
      case "message":
        return (
          <Message
            key={event.id}
            role={event.role}
            content={event.content}
            timestamp={event.timestamp}
            messageId={event.messageId}
            verification={event.verification}
            proof={event.proof}
            remoteProof={event.remoteProof}
            model={model}
            markdown={markdown}
          />
        );
      case "tool_call":
        return (
          <ToolMessage
            key={event.id}
            kind="tool_call"
            toolName={event.toolName}
            payload={event.input}
            status={event.status}
          />
        );
      case "tool_result":
        return (
          <ToolMessage
            key={event.id}
            kind="tool_result"
            toolName={event.toolName}
            payload={event.output}
            status={event.status}
          />
        );
      case "status":
        return (
          <Status
            key={event.id}
            label={event.label}
            detail={event.detail}
            level={event.level}
          />
        );
      case "sub_agent":
        return (
          <AgentMessage
            key={event.id}
            agentName={event.agentName}
            phase={event.phase}
            detail={event.detail}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        className="absolute inset-x-0 top-0 overflow-y-scroll px-4 sm:px-6 pt-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        style={{
          bottom: `${footerHeight}px`,
          paddingBottom: `${footerHeight}px`,
        }}
      >
        {events.length === 0 && isInitialized ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h3 className="text-lg font-semibold mb-2">Welcome</h3>
            <p className="text-sm text-muted-foreground">{welcomeMessage}</p>
          </div>
        ) : (
          <div className="space-y-6 max-w-4xl mx-auto">
            {events.map((event) => renderEvent(event))}
            {showTypingIndicator && <TypingIndicator />}
          </div>
        )}
      </div>

      {!isAtBottom && (
        <ScrollToBottom onClick={scrollToBottom} offset={buttonOffset} />
      )}
    </div>
  );
};
