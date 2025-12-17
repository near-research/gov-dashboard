"use client";

import { MessagePrimitive, useMessage, ActionBarPrimitive } from "@assistant-ui/react";
import { useVerificationSafe } from "@/contexts/VerificationContext";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { ProposalCards } from "@/components/chat/ProposalCards";
import { Markdown } from "@/components/proposal/Markdown";
import { Copy, RefreshCw } from "lucide-react";

function extractProposalList(text: string): unknown[] | null {
  const proposalListMatch = text.match(/```json\n(\[[\s\S]*?"type"\s*:\s*"proposal"[\s\S]*?\])\n```/);
  if (proposalListMatch) {
    try {
      const parsed = JSON.parse(proposalListMatch[1]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to parse proposal JSON:", e);
    }
  }

  const singleProposalMatch = text.match(/```json\n(\{[\s\S]*?"type"\s*:\s*"proposal"[\s\S]*?\})\n```/);
  if (singleProposalMatch) {
    try {
      const parsed = JSON.parse(singleProposalMatch[1]);
      if (parsed && parsed.type === "proposal") {
        return [parsed];
      }
    } catch (e) {
      console.warn("Failed to parse single proposal JSON:", e);
    }
  }

  return null;
}

function stripProposalJson(text: string): string {
  return text
    .replace(/```json\n\[[\s\S]*?"type"\s*:\s*"proposal"[\s\S]*?\]\n```/g, "")
    .replace(/```json\n\{[\s\S]*?"type"\s*:\s*"proposal"[\s\S]*?\}\n```/g, "")
    .trim();
}

interface TextPartProps {
  text: string;
}

function TextPart({ text }: TextPartProps) {
  const proposals = extractProposalList(text);
  const displayText = proposals ? stripProposalJson(text) : text;

  return (
    <div className="space-y-3">
      {displayText && (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-headings:my-3">
          <Markdown content={displayText} />
        </div>
      )}
      {proposals && proposals.length > 0 && (
        <div className="not-prose">
          <ProposalCards proposals={proposals} />
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
        <button
          className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          title="Copy message"
        >
          <Copy className="w-4 h-4" />
        </button>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <button
          className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          title="Regenerate response"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex gap-3 p-4 flex-row-reverse">
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
          U
        </div>
      </div>
      <div className="flex-1 min-w-0 text-right">
        <div className="flex items-center gap-2 justify-end mb-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">You</span>
        </div>
        <div className="inline-block max-w-[85%] text-left">
          <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 bg-blue-600 text-white">
            <MessagePrimitive.Parts
              components={{
                Text: ({ text }) => <span className="whitespace-pre-wrap">{text}</span>,
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
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 text-white flex items-center justify-center text-sm font-medium">
          A
        </div>
        {isVerified && (
          <div className="absolute -bottom-1 -right-1">
            <VerificationBadge size="sm" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Delegate Agent
          </span>
          {isVerified && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <VerificationBadge size="sm" />
              <span className="hidden sm:inline">TEE Verified</span>
            </span>
          )}
          {isStreaming && (
            <span className="text-xs text-gray-400 animate-pulse">typing...</span>
          )}
        </div>
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-gray-100 dark:bg-gray-800">
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
      <div className="text-sm text-gray-500 italic text-center">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

export { UserMessage, AssistantMessage };
