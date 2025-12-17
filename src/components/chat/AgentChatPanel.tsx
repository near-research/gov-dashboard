"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { GovernanceRuntimeProvider } from "@/providers/GovernanceRuntimeProvider";
import { GovernanceThread } from "@/components/assistant-ui/GovernanceThread";
import { VerificationPanel } from "@/components/verification/VerificationPanel";
import { cn } from "@/utils/tailwind";

export interface AgentChatPanelProps {
  agentId: string;
  showVerification?: boolean;
  className?: string;
  onError?: (error: Error) => void;
}

export function AgentChatPanel({
  agentId,
  showVerification = true,
  className,
  onError,
}: AgentChatPanelProps) {
  const handleError = useCallback(
    (error: Error) => {
      console.error("[AgentChatPanel] Error:", error);
      toast.error("Agent Error", {
        description: error.message || "Something went wrong",
      });
      onError?.(error);
    },
    [onError]
  );

  return (
    <GovernanceRuntimeProvider agentId={agentId} onError={handleError}>
      <div className={cn("flex flex-col h-full bg-white dark:bg-gray-900", className)}>
        {showVerification && (
          <header className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
            <VerificationPanel />
          </header>
        )}

        <div className="flex-1 min-h-0">
          <GovernanceThread />
        </div>
      </div>
    </GovernanceRuntimeProvider>
  );
}

export interface AgentChatPanelWithSidebarProps extends AgentChatPanelProps {
  sidebar?: React.ReactNode;
  sidebarWidth?: string;
}

export function AgentChatPanelWithSidebar({
  sidebar,
  sidebarWidth = "w-80",
  ...props
}: AgentChatPanelWithSidebarProps) {
  return (
    <GovernanceRuntimeProvider agentId={props.agentId} onError={props.onError}>
      <div className={cn("flex h-full bg-white dark:bg-gray-900", props.className)}>
        <div className="flex-1 flex flex-col min-w-0">
          {props.showVerification !== false && (
            <header className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
              <VerificationPanel />
            </header>
          )}
          <div className="flex-1 min-h-0">
            <GovernanceThread />
          </div>
        </div>

        {sidebar && (
          <aside
            className={cn(
              "flex-shrink-0 border-l border-gray-200 dark:border-gray-700 overflow-y-auto hidden lg:block",
              sidebarWidth
            )}
          >
            {sidebar}
          </aside>
        )}
      </div>
    </GovernanceRuntimeProvider>
  );
}

export default AgentChatPanel;
