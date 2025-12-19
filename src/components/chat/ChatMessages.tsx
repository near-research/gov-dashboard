// components/chat/ChatMessages.tsx
import React, { useRef, useEffect, useMemo, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";
import { Message } from "./Message";
import { AgentMessage } from "./AgentMessage";
import type MarkdownIt from "markdown-it";
import {
  mapRoleToDisplayRoleMeta,
  type AgentUIEvent,
  type MessageUIEvent,
  type ToolCallUIEvent,
} from "@/types/agent-ui";
import { ToolHistoryCard, type ToolHistoryStatus } from "./ToolHistoryCard";
import ProposalCard from "@/components/proposal/ProposalCard";
import type { ProposalDisplayData } from "@/components/proposal/types/proposals";
import { logger } from "@/lib/logger";

interface ChatMessagesProps {
  events: AgentUIEvent[];
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
    <div
      className="flex justify-start"
      data-testid="typing-indicator"
      role="status"
      aria-live="polite"
      aria-label="Assistant is typing"
    >
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
          aria-label="Scroll to bottom"
          data-testid="scroll-to-bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

type TurnStatus = ToolHistoryStatus;

interface TurnInfo {
  turnNumber: number;
  tools: ToolCallUIEvent[];
  assistantMessages: MessageUIEvent[];
  status: TurnStatus;
  proposalList?: ProposalDisplayData | null;
  toolMap?: Map<string, ToolCallUIEvent>;
}

const parseProposalListPayload = (
  payload?: string | null
): ProposalDisplayData | null => {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (parsed.type === "proposal_list" && Array.isArray(parsed.topics)) {
      return parsed as ProposalDisplayData;
    }
  } catch {
    // ignore parse errors
  }
  return null;
};

const extractProposalListFromContent = (
  content: string
): ProposalDisplayData | null => {
  const codeMatch = content.match(/```json\s*\n([\s\S]*?)```/i);
  const fromCodeBlock = parseProposalListPayload(codeMatch?.[1]);
  if (fromCodeBlock) return fromCodeBlock;

  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const direct = parseProposalListPayload(trimmed);
    if (direct) return direct;
  }
  return null;
};

const extractProposalListFromTool = (
  tool: ToolCallUIEvent
): ProposalDisplayData | null => {
  if (!tool.output || typeof tool.output !== "string") return null;
  return parseProposalListPayload(tool.output);
};

const stripProposalJsonBlock = (content: string): string =>
  content.replace(/```json[\s\S]*?```/gi, "").trim();


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

  const lastUserMessage = (() => {
    const userMessages = events.filter(
      (e) => e.kind === "message" && e.role === "user"
    );
    return userMessages[userMessages.length - 1];
  })();

  const lastUserTurnNumber = lastUserMessage?.turnNumber || 0;
  const currentTurnNumber = lastUserTurnNumber;

  const { turnInfoMap, relevantTurnInfos } = useMemo(() => {
    const map = new Map<number, TurnInfo>();

      const buckets = events.reduce<Record<number, TurnInfo>>((acc, event) => {
        if (event.kind !== "tool_call" && event.kind !== "message") {
          return acc;
        }
        const existing =
          acc[event.turnNumber] ??
          {
            turnNumber: event.turnNumber,
            tools: [],
            assistantMessages: [],
            status: "awaiting_response" as TurnStatus,
            proposalList: null,
            toolMap: new Map<string, ToolCallUIEvent>(),
          };
      if (event.kind === "tool_call") {
        const map = existing.toolMap ?? new Map<string, ToolCallUIEvent>();
        map.set(event.toolCallId, event);
        existing.toolMap = map;
        existing.tools = Array.from(map.values());
        if (!existing.proposalList) {
          existing.proposalList = extractProposalListFromTool(event);
        }
        } else if (event.kind === "message" && event.role === "assistant") {
          existing.assistantMessages = [...existing.assistantMessages, event];
        }
      acc[event.turnNumber] = existing;
      return acc;
    }, {});

    const relevant = Object.values(buckets)
      .filter((info) => info.tools.length > 0)
      .map((info) => {
        const hasActive = info.tools.some(
          (tool) => tool.status === "running" || tool.status === "pending"
        );
        const hasResponse = info.assistantMessages.some(
          (msg) => msg.content.length > 0
        );
        info.status = hasActive
          ? "active"
          : hasResponse
          ? "completed"
          : "awaiting_response";
        map.set(info.turnNumber, info);
        return info;
      })
      .sort((a, b) => a.turnNumber - b.turnNumber);

    return {
      turnInfoMap: map,
      relevantTurnInfos: relevant,
    };
  }, [events]);
  if (process.env.NODE_ENV !== "production") {
    logger.debug("[ChatMessages Debug]", {
      totalEvents: events.length,
      currentTurnNumber,
    });
  }

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

  const renderEvent = (event: AgentUIEvent, _index: number) => {
    // Hide all tool/status messages from main chat
    if (
      event.kind === "tool_call" ||
      event.kind === "tool_result" ||
      event.kind === "status"
    ) {
      return null;
    }

    const turnInfo = turnInfoMap.get(event.turnNumber);
    const displayRoleMeta =
      event.kind === "message" ? mapRoleToDisplayRoleMeta(event.role) : null;
    const shouldShowToolHistory =
      event.kind === "message" &&
      displayRoleMeta?.role === "assistant" &&
      event.content.length > 0 &&
      turnInfo !== undefined &&
      turnInfo.tools.length > 0;
    const isAssistantPlaceholder =
      event.kind === "message" &&
      event.role === "assistant" &&
      event.content.trim().length === 0;

    const messageHasProposalJson =
      event.kind === "message"
        ? Boolean(extractProposalListFromContent(event.content))
        : false;

    const isFirstAssistantMessageForTurn =
      turnInfo?.assistantMessages[0]?.id === event.id;

    const proposalList = turnInfo?.proposalList || null;

    const showProposalList =
      proposalList &&
      proposalList.topics.length > 0 &&
      (messageHasProposalJson || isFirstAssistantMessageForTurn);

    const proposalListElement = showProposalList ? (
      <div className="mt-3 space-y-3">
        {proposalList.description ? (
          <p className="text-sm text-muted-foreground">
            {proposalList.description}
          </p>
        ) : null}
        <div className="space-y-3">
          {proposalList.topics.map((topic, index) => (
            <ProposalCard
              key={`${topic.id}-${index}`}
              id={topic.id}
              title={topic.title}
              excerpt={topic.excerpt}
              created_at={topic.created_at}
              username={topic.author}
              topic_id={topic.id}
              topic_slug={topic.slug}
              reply_count={topic.reply_count}
              views={topic.views}
              last_posted_at={topic.last_posted_at}
            />
          ))}
        </div>
      </div>
    ) : null;
    const toolHistoryElement =
      shouldShowToolHistory && turnInfo ? (
        <div key={`tools-after-${event.id}`} className="flex justify-start mt-4">
          <ToolHistoryCard status={turnInfo.status} tools={turnInfo.tools} />
        </div>
      ) : null;

    switch (event.kind) {
      case "message":
        const sanitizedContent = messageHasProposalJson
          ? stripProposalJsonBlock(event.content) ||
            turnInfo?.proposalList?.description ||
            "Proposal results:"
          : event.content;

              return (
                <Fragment key={event.id}>
                  {!isAssistantPlaceholder && (
                    <Message
                      role={displayRoleMeta?.role ?? "assistant"}
                      label={displayRoleMeta?.label}
                      rawRole={event.role}
                      content={event.content}
                      displayContent={sanitizedContent}
                      timestamp={event.timestamp}
                      markdown={markdown}
                      verification={event.verification ?? null}
                    />
                  )}
            {proposalListElement}
            {toolHistoryElement}
          </Fragment>
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
        data-testid="chat-feed"
        className="absolute inset-x-0 top-0 overflow-y-scroll px-4 sm:px-6 pt-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        style={{
          bottom: `${footerHeight}px`,
          paddingBottom: `${footerHeight}px`,
        }}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        aria-atomic="false"
      >
        <div className="space-y-6 max-w-4xl mx-auto">
          {events.length === 0 && isInitialized ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <h3 className="text-lg font-semibold mb-2">Welcome</h3>
              <p className="text-sm text-muted-foreground">{welcomeMessage}</p>
            </div>
          ) : (
            <>
              {events.map((event, index) => renderEvent(event, index))}
              {showTypingIndicator && <TypingIndicator />}
            </>
          )}
        </div>
      </div>

      {!isAtBottom && (
        <ScrollToBottom onClick={scrollToBottom} offset={buttonOffset} />
      )}
    </div>
  );
};
