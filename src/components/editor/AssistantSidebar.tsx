import { useCallback } from "react";
import { toast } from "sonner";
import { EvaluationPanel, type EvaluationPanelProps } from "@/components/editor/EvaluationPanel";
import { PublishBar, type PublishBarProps } from "@/components/editor/PublishBar";
import { GovernanceRuntimeProvider } from "@/providers/GovernanceRuntimeProvider";
import { GovernanceThread } from "@/components/assistant-ui/GovernanceThread";

const DEFAULT_AGENT_ID = process.env.NEXT_PUBLIC_AGENT_ID ?? "governance-delegate";

type AssistantSidebarProps = {
  publishBarProps: PublishBarProps;
  evaluationPanelProps: EvaluationPanelProps;
};

export function AssistantSidebar({
  publishBarProps,
  evaluationPanelProps,
}: AssistantSidebarProps) {
  const handleError = useCallback(
    (error: Error) => {
      console.error("[AssistantSidebar] Agent error:", error);
      toast.error("Agent Error", {
        description: error.message || "Something went wrong",
      });
    },
    []
  );

  return (
    <GovernanceRuntimeProvider agentId={DEFAULT_AGENT_ID} onError={handleError}>
      <div
        style={{
          position: "sticky",
          top: "0",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
          maxHeight: "calc(100vh - 150px)",
          alignSelf: "stretch",
        }}
      >
        <PublishBar {...publishBarProps} />
        <EvaluationPanel {...evaluationPanelProps} />
        <div
          className="card flex-1 min-h-0"
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <div className="flex-1 min-h-0">
            <GovernanceThread showProposals={false} />
          </div>
        </div>
      </div>
    </GovernanceRuntimeProvider>
  );
}
