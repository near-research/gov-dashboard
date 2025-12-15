import { useState } from "react";
import type { Evaluation } from "@/types/evaluation";
import { Button } from "@/components/ui/button";
import { NearErrorAlert } from "@/components/ui/NearErrorAlert";
import { useNear } from "@/hooks/useNear";
import { useGovernanceAnalytics } from "@/lib/analytics";
import {
  createNearOperationError,
  logNearError,
  type NearOperationError,
} from "@/utils/errors/near-errors";
import { handleScreeningResponse } from "@/utils/errors/screening-errors";
import { screenProposalRevision } from "@/utils/screening/screen-proposal";

interface ScreeningButtonProps {
  topicId: string;
  title: string;
  content: string;
  revisionNumber: number;
  onScreeningComplete?: () => void;
}

export function ScreeningButton({
  topicId,
  title,
  content,
  revisionNumber,
  onScreeningComplete,
}: ScreeningButtonProps) {
  const { signedAccountId, walletSigner, loading, signIn } = useNear();
  const track = useGovernanceAnalytics();

  const [screening, setScreening] = useState(false);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState<NearOperationError | null>(null);

  const prepareContent = (html: string): string => {
    const normalized = html;
    if (typeof document !== "undefined") {
      const div = document.createElement("div");
      div.innerHTML = normalized;
      return (div.textContent || div.innerText || "")
        .replace(/\r?\n{3,}/g, "\n\n")
        .trim();
    }
    return normalized
      .replace(/<[^>]*>/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  };

  const handleScreen = async () => {
    setScreening(true);
    setError(null);
    setResult(null);

    track("proposal_screening_started", {
      props: { topic_id: topicId, revision: revisionNumber },
    });

    try {
      const { response: saveResponse, payload: parsedPayload } =
        await screenProposalRevision({
          proposalId: topicId,
          title,
          content: prepareContent(content),
          revisionNumber,
          walletSigner,
          signedAccountId,
        });

      const screeningResult = handleScreeningResponse(
        saveResponse,
        {
          topicId,
          revisionNumber,
          accountId: signedAccountId!,
        },
        parsedPayload
      );

      if (!screeningResult.success) {
        if (screeningResult.shouldTrack) {
          track(screeningResult.shouldTrack.event, {
            props: screeningResult.shouldTrack.props,
          });
        }
        const nearError =
          screeningResult.error ??
          createNearOperationError(new Error("Screening failed."));
        logNearError("ScreeningButton.handleScreen", nearError);
        setError(nearError);
        return;
      }

      const saveData = (parsedPayload ?? {}) as {
        evaluation?: Evaluation;
      };
      const evaluation = saveData.evaluation ?? null;

      if (!evaluation) {
        throw new Error("Missing evaluation data in response");
      }

      setResult(evaluation);

      track("proposal_screening_succeeded", {
        props: {
          topic_id: topicId,
          revision: revisionNumber,
          overall_pass: evaluation.overallPass,
        },
      });

      onScreeningComplete?.();
    } catch (err: unknown) {
      const nearError = createNearOperationError(err);
      logNearError("ScreeningButton.handleScreen", nearError);
      setError(nearError);
      track("proposal_screening_failed", {
        props: {
          topic_id: topicId,
          revision: revisionNumber,
          message: nearError.message,
        },
      });
    } finally {
      setScreening(false);
    }
  };

  const formatScore = (score: number) => `${(score * 100).toFixed(0)}%`;

  if (result) {
    return (
      <div
        className="card mb-8"
        style={{
          backgroundColor: result.overallPass ? "#f0fdf4" : "#fef2f2",
          borderLeft: `4px solid ${result.overallPass ? "#10b981" : "#ef4444"}`,
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">{result.overallPass ? "✓" : "✗"}</span>
          <h3 className="text-lg font-semibold">
            {result.overallPass ? "Screening Passed" : "Screening Failed"}
          </h3>
        </div>

        <div className="mb-3 text-sm">
          <div className="flex gap-4 mb-1">
            <div>
              <strong>Quality:</strong> {formatScore(result.qualityScore)}
            </div>
            <div>
              <strong>Attention:</strong> {formatScore(result.attentionScore)}
            </div>
          </div>
          <p className="text-muted-foreground">
            Relevant: {result.relevant?.score || "unknown"} • Material:{" "}
            {result.material?.score || "unknown"}
          </p>
        </div>

        <p className="mb-3">
          <strong>Summary:</strong> {result.summary}
        </p>
        <p className="text-sm text-muted-foreground">
          ✓ Results saved! Screening status has been updated.
        </p>
      </div>
    );
  }

  // Show loading state
  if (loading) {
    return (
      <div className="card mb-8 p-4">
        <p className="text-sm text-muted-foreground">Loading wallet...</p>
      </div>
    );
  }

  return (
    <div className="card mb-8 p-4">
      <h3 className="text-lg font-semibold mb-2">AI Screening</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Screen this proposal (version {revisionNumber}) against NEAR governance
        criteria using AI.
        {!signedAccountId && (
          <span className="block mt-1 text-red-500">
            ⚠ Please connect your NEAR wallet to screen proposals.
          </span>
        )}
      </p>
      <NearErrorAlert
        error={error}
        onRetry={() => {
          setError(null);
          void handleScreen();
        }}
        onReconnect={() => {
          setError(null);
          void signIn();
        }}
        onDismiss={() => setError(null)}
        className="mb-3"
      />
      <Button
        onClick={handleScreen}
        disabled={screening || !signedAccountId}
        className="w-full"
      >
        {screening
          ? "Screening..."
          : signedAccountId
          ? "Screen This Proposal"
          : "Connect Wallet to Screen"}
      </Button>
    </div>
  );
}
