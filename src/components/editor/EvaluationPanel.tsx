import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScreeningBadge } from "@/components/proposal/screening/ScreeningBadge";
import { VerificationBadge } from "@/components/VerificationBadge";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";
import { useMemo } from "react";

export type EvaluationPanelProps = {
  evaluationError: string;
  evaluation: Evaluation | null;
  evaluationVerification?: VerificationMetadata;
  signedAccountId?: string | null;
};

export function EvaluationPanel({
  evaluationError,
  evaluation,
  evaluationVerification,
  signedAccountId,
}: EvaluationPanelProps) {
  console.log("[Screen] Rendering results:", evaluation);
  const screeningData = useMemo(() => {
    if (!evaluation) return null;
    return {
      evaluation,
      title: "",
      nearAccount: signedAccountId ?? "NEAR account",
      timestamp: new Date().toISOString(),
      revisionNumber: 1,
      qualityScore: evaluation.qualityScore ?? 0,
      attentionScore: evaluation.attentionScore ?? 0,
      model: evaluation.model ?? undefined,
    };
  }, [evaluation, signedAccountId]);
  return (
    <div className="card" style={{ padding: "1.2rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {evaluationError && (
          <Alert className="border-red-500 bg-red-50 text-red-900">
            <AlertDescription>{evaluationError}</AlertDescription>
          </Alert>
        )}
        {screeningData && (
          <div
            style={{
              marginTop: "0.75rem",
            }}
          >
            <ScreeningBadge screening={screeningData} defaultExpanded={false} />
          </div>
        )}
      </div>
    </div>
  );
}
