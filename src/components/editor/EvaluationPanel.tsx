import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EvaluationSummary } from "@/components/editor/EvaluationSummary";
import { VerificationBadge } from "@/components/VerificationBadge";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";

export type EvaluationPanelProps = {
  evaluationError: string;
  evalLoading: boolean;
  evaluateDraft: () => Promise<void> | void;
  evaluation: Evaluation | null;
  showEvalDetails: boolean;
  onToggleEvalDetails: () => void;
  remainingEvaluations: number | null;
  rateLimitResetSeconds: number | null;
  evaluationVerification?: VerificationMetadata;
  evaluationChatId?: string;
};

export function EvaluationPanel({
  evaluationError,
  evalLoading,
  evaluateDraft,
  evaluation,
  showEvalDetails,
  onToggleEvalDetails,
  remainingEvaluations,
  rateLimitResetSeconds,
  evaluationVerification,
}: EvaluationPanelProps) {
  return (
    <div className="card" style={{ padding: "1.2rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={{ fontWeight: 600 }}>Screen</div>
        <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>
          Check against criteria before publishing.
        </p>
        {evaluationError && (
          <Alert className="border-red-500 bg-red-50 text-red-900">
            <AlertDescription>{evaluationError}</AlertDescription>
          </Alert>
        )}
        <Button
          onClick={evaluateDraft}
          disabled={evalLoading}
          className="w-full"
        >
          {evalLoading ? "Evaluating..." : "Run screening"}
        </Button>
        {evaluation && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.9rem",
              marginTop: "0.35rem",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}
            >
              <VerificationBadge
                verification={evaluationVerification ?? null}
                className="text-[10px]"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={onToggleEvalDetails}
            >
              {showEvalDetails ? "Hide results" : "Show results"}
            </Button>
          </div>
        )}
        {evaluation && showEvalDetails && (
          <div
            style={{
              maxHeight: "240px",
              overflowY: "auto",
              marginTop: "0.5rem",
            }}
          >
            <EvaluationSummary evaluation={evaluation} />
          </div>
        )}
        {remainingEvaluations !== null && remainingEvaluations > 0 && (
          <Alert className="border-blue-500 bg-blue-50 text-blue-900">
            <AlertDescription>
              {`You can do ${remainingEvaluations} more evaluation${
                remainingEvaluations !== 1 ? "s" : ""
              } in the next ${
                rateLimitResetSeconds !== null
                  ? Math.max(1, Math.ceil(rateLimitResetSeconds / 60))
                  : 15
              } minute${
                rateLimitResetSeconds !== null &&
                Math.max(1, Math.ceil(rateLimitResetSeconds / 60)) !== 1
                  ? "s"
                  : ""
              }.`}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
