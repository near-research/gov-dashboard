"use client";

import {
  MessagePrimitive,
  useMessage,
  ActionBarPrimitive,
} from "@assistant-ui/react";
import { useVerificationSafe } from "@/contexts/VerificationContext";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { ProposalCards } from "@/components/chat/ProposalCards";
import { Markdown } from "@/components/proposal/Markdown";
import type { ProposalDisplayData } from "@/components/proposal/types/proposals";
import { Button } from "@/components/ui/button";
import { Copy, RefreshCw } from "lucide-react";

function parseProposalListPayload(
  payload?: string | null
): ProposalDisplayData | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as ProposalDisplayData).type === "proposal_list" &&
      Array.isArray((parsed as ProposalDisplayData).topics)
    ) {
      return parsed as ProposalDisplayData;
    }
  } catch (error) {
    console.warn("Failed to parse proposal list JSON:", error);
  }
  return null;
}

function extractProposalList(text: string): ProposalDisplayData | null {
  const regex = /```json\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(text))) {
    const proposalList = parseProposalListPayload(match[1]);
    if (proposalList) {
      return proposalList;
    }
  }

  const trimmed = text.trim();
  return parseProposalListPayload(trimmed);
}

function stripProposalJson(text: string): string {
  const regex = /```json\s*\n([\s\S]*?)```/gi;
  let cleaned = text;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(text))) {
    if (parseProposalListPayload(match[1])) {
      cleaned = cleaned.replace(match[0], "");
    }
  }
  return cleaned.trim();
}

interface TextPartProps {
  text: string;
}

function TextPart({ text }: TextPartProps) {
  const proposalList = extractProposalList(text);
  const displayText = proposalList ? stripProposalJson(text) : text;

  return (
    <div className="space-y-3">
      {displayText && (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-headings:my-3">
          <Markdown content={displayText} />
        </div>
      )}
      {proposalList && (
        <div className="not-prose">
          <ProposalCards proposalList={proposalList} />
        </div>
      )}
    </div>
  );
}

function MessageActionBar() {
  return (
    <ActionBarPrimitive.Root
      className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
      autohide="not-last"
      hideWhenRunning
    >
      <ActionBarPrimitive.Copy asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title="Copy message"
        >
          <Copy className="w-4 h-4" />
        </Button>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title="Regenerate response"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex gap-3 p-4 flex-row-reverse">
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
          U
        </div>
      </div>
      <div className="flex-1 min-w-0 text-right">
        <div className="flex items-center gap-2 justify-end mb-1">
          <span className="text-sm font-medium text-foreground">
            You
          </span>
        </div>
        <div className="inline-block max-w-[85%] text-left">
          <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 bg-primary text-primary-foreground">
            <MessagePrimitive.Parts
              components={{
                Text: ({ text }) => (
                  <span className="whitespace-pre-wrap">{text}</span>
                ),
              }}
            />
          </div>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const status = useMessage((m) => m.status);
  const verification = useVerificationSafe();
  const isStreaming = status?.type === "running";
  const isVerified = verification?.state.status === "verified";

  return (
    <MessagePrimitive.Root className="group flex gap-3 p-4">
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/90 via-secondary/80 to-accent/80 text-primary-foreground flex items-center justify-center text-sm font-medium shadow-md">
          A
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-foreground">
            Gov Assistant
          </span>
          {isVerified && (
            <span className="inline-flex items-center gap-1 text-xs text-accent dark:text-accent-foreground">
              <VerificationBadge size="sm" />
              <span className="hidden sm:inline">TEE Verified</span>
            </span>
          )}
          {isStreaming && (
            <span className="text-xs text-muted-foreground animate-pulse">
              typing...
            </span>
          )}
        </div>
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-muted text-foreground">
            <MessagePrimitive.Parts
              components={{
                Text: TextPart,
              }}
            />
          </div>
          <MessageActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

export function GovernanceMessage() {
  const role = useMessage((m) => m.role);
  if (role === "user") {
    return <UserMessage />;
  }
  if (role === "assistant") {
    return <AssistantMessage />;
  }
  return (
    <MessagePrimitive.Root className="p-4">
      <div className="text-sm text-muted-foreground italic text-center">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

export { UserMessage, AssistantMessage };
