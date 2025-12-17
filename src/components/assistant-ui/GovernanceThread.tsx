"use client";

import {
  ThreadPrimitive,
  ComposerPrimitive,
  AssistantIf,
} from "@assistant-ui/react";
import { GovernanceMessage } from "./GovernanceMessage";
import { GovernanceToolUIs } from "./tools";
import { useVerificationSafe } from "@/contexts/VerificationContext";
import { Send, Square, ChevronDown, Paperclip, ShieldCheck } from "lucide-react";
import { cn } from "@/utils/tailwind";

function ThreadEmpty() {
  const verification = useVerificationSafe();
  const isVerified = verification?.state.status === "verified";

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 flex items-center justify-center shadow-lg">
          <span className="text-4xl">🏛️</span>
        </div>
        {isVerified && (
          <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shadow-md">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
        )}
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        NEAR Governance Assistant
      </h2>
      <p className="text-gray-600 dark:text-gray-400 max-w-md mb-8">
        Ask about proposals, voting, delegation, or any House of Stake governance topics.
        {isVerified && " Running in a verified TEE environment."}
      </p>
      <div className="flex flex-wrap gap-2 justify-center max-w-lg">
        {[
          "What proposals are currently active?",
          "Summarize the latest governance discussions",
          "How does the voting process work?",
          "What is veNEAR and how does delegation work?",
        ].map((prompt) => (
          <ThreadPrimitive.Suggestion
            key={prompt}
            prompt={prompt}
            className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors cursor-pointer"
          />
        ))}
      </div>
    </div>
  );
}

function ScrollToBottomButton() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button
        className={cn(
          "absolute bottom-28 right-6 z-10",
          "p-2.5 rounded-full",
          "bg-white dark:bg-gray-800",
          "border border-gray-200 dark:border-gray-700",
          "shadow-lg",
          "hover:bg-gray-50 dark:hover:bg-gray-700",
          "transition-all",
          "disabled:opacity-0 disabled:pointer-events-none"
        )}
        title="Scroll to bottom"
      >
        <ChevronDown className="w-5 h-5 text-gray-600 dark:text-gray-400" />
      </button>
    </ThreadPrimitive.ScrollToBottom>
  );
}

function ThreadComposer() {
  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <ComposerPrimitive.Root className="flex items-end gap-3 max-w-4xl mx-auto">
        <ComposerPrimitive.AddAttachment asChild>
          <button
            className={cn(
              "p-2.5 rounded-xl",
              "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300",
              "hover:bg-gray-100 dark:hover:bg-gray-800",
              "transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            title="Add attachment"
          >
            <Paperclip className="w-5 h-5" />
          </button>
        </ComposerPrimitive.AddAttachment>

        <ComposerPrimitive.Input
          placeholder="Ask about governance, proposals, voting..."
          className={cn(
            "flex-1",
            "min-h-[48px] max-h-[200px]",
            "px-4 py-3",
            "bg-gray-100 dark:bg-gray-800",
            "border border-gray-200 dark:border-gray-700",
            "rounded-2xl",
            "resize-none",
            "text-gray-900 dark:text-gray-100",
            "placeholder:text-gray-500 dark:placeholder:text-gray-400",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          autoFocus
          data-testid="chat-input"
        />

        <AssistantIf condition={({ thread }) => !thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <button
              className={cn(
                "p-3 rounded-xl",
                "bg-blue-600 hover:bg-blue-700",
                "text-white",
                "transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
              title="Send message"
              aria-label="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          </ComposerPrimitive.Send>
        </AssistantIf>

        <AssistantIf condition={({ thread }) => thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <button
              className={cn(
                "p-3 rounded-xl",
                "bg-red-600 hover:bg-red-700",
                "text-white",
                "transition-colors"
              )}
              title="Stop generating"
            >
              <Square className="w-5 h-5" />
            </button>
          </ComposerPrimitive.Cancel>
        </AssistantIf>
      </ComposerPrimitive.Root>
      <p className="text-xs text-gray-500 text-center mt-3 max-w-4xl mx-auto">
        Governance Assistant may make mistakes. Verify important information.
      </p>
    </div>
  );
}

export function GovernanceThread() {
  return (
    <>
      <GovernanceToolUIs />

      <ThreadPrimitive.Root className="flex flex-col h-full bg-white dark:bg-gray-900">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
          <ThreadPrimitive.Empty>
            <ThreadEmpty />
          </ThreadPrimitive.Empty>

          <AssistantIf condition={({ thread }) => !thread.isEmpty}>
            <div className="min-h-8 flex-grow" />
          </AssistantIf>

          <div className="max-w-4xl mx-auto w-full">
            <ThreadPrimitive.Messages components={{ Message: GovernanceMessage }} />
          </div>

          <div className="h-4" />
        </ThreadPrimitive.Viewport>

      <ScrollToBottomButton />
      <ThreadComposer />
    </ThreadPrimitive.Root>
  </>
);
}
