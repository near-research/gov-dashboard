import { useState } from "react";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";
import { sign } from "near-sign-verify";
import { Button } from "@/components/ui/button";
import { useNear } from "@/hooks/useNear";
import { useGovernanceAnalytics } from "@/lib/analytics";
import { VerificationProof } from "@/components/verification/VerificationProof";

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
  const { signedAccountId, wallet, loading } = useNear();
  const track = useGovernanceAnalytics();

  const [screening, setScreening] = useState(false);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
  const [verificationMeta, setVerificationMeta] =
    useState<VerificationMetadata | null>(null);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

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
    setError("");
    setResult(null);
    setVerificationMeta(null);
    setVerificationId(null);
    setModel(null);

    track("proposal_screening_started", {
      props: { topic_id: topicId, revision: revisionNumber },
    });

    try {
      if (!wallet)
        throw new Error(
          "Wallet not connected. Please connect your NEAR wallet."
        );
      if (!signedAccountId)
        throw new Error("NEAR account not found. Please connect your wallet.");

      const authToken = await sign(`Screen proposal ${topicId}`, {
        signer: wallet,
        recipient: "social.near",
      });

      const saveResponse = await fetch(`/api/saveAnalysis/${topicId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title,
          content: prepareContent(content),
          revisionNumber,
        }),
      });

      const saveData: unknown = await saveResponse.json();
      if (!saveResponse.ok) {
        const message =
          typeof saveData === "object" && saveData !== null
            ? (saveData as { message?: string }).message
            : undefined;

        if (saveResponse.status === 401) {
          const errorMsg = "Authentication failed. Please try signing again.";
          setError(errorMsg);
          track("proposal_screening_failed", {
            props: {
              topic_id: topicId,
              revision: revisionNumber,
              message: errorMsg,
            },
          });
        } else if (saveResponse.status === 409) {
          const errorMsg =
            message || "This proposal revision has already been evaluated.";
          setError(errorMsg);
          track("proposal_screening_failed", {
            props: {
              topic_id: topicId,
              revision: revisionNumber,
              message: errorMsg,
            },
          });
        } else if (saveResponse.status === 429) {
          const errorMsg =
            message || "Rate limit exceeded. Please try again later.";
          setError(errorMsg);
          track("proposal_screening_failed", {
            props: {
              topic_id: topicId,
              revision: revisionNumber,
              message: errorMsg,
            },
          });
        } else {
          throw new Error(
            (typeof saveData === "object" && saveData !== null
              ? (saveData as { error?: string }).error
              : undefined) || `Failed to save screening: ${saveResponse.status}`
          );
        }
        return;
      }

      const evaluation =
        typeof saveData === "object" &&
        saveData !== null &&
        "evaluation" in saveData
          ? (saveData as { evaluation: Evaluation }).evaluation
          : null;
      const verification =
        typeof saveData === "object" &&
        saveData !== null &&
        "verification" in saveData
          ? (saveData as { verification?: VerificationMetadata | null })
              .verification ?? null
          : null;
      const proofVerificationId =
        typeof saveData === "object" &&
        saveData !== null &&
        "verificationId" in saveData
          ? (saveData as { verificationId?: string | null }).verificationId ??
            null
          : null;

      if (!evaluation) {
        throw new Error("Missing evaluation data in response");
      }

      setResult(evaluation);
      setVerificationMeta(verification);
      setVerificationId(proofVerificationId ?? verification?.messageId ?? null);
      const responseModel =
        typeof saveData === "object" && saveData !== null && "model" in saveData
          ? (saveData as { model?: string | null }).model ?? null
          : null;
      setModel(responseModel ?? evaluation.model ?? null);

      track("proposal_screening_succeeded", {
        props: {
          topic_id: topicId,
          revision: revisionNumber,
          overall_pass: evaluation.overallPass,
        },
      });

      onScreeningComplete?.();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to screen proposal";
      setError(message);
      track("proposal_screening_failed", {
        props: { topic_id: topicId, revision: revisionNumber, message },
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
        {(verificationMeta || verificationId) && (
          <div className="mt-4">
            <VerificationProof
              verification={verificationMeta ?? undefined}
              verificationId={verificationId ?? undefined}
              model={model ?? result?.model ?? undefined}
            />
          </div>
        )}
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
        {!wallet && (
          <span className="block mt-1 text-red-500">
            ⚠ Please connect your NEAR wallet to screen proposals.
          </span>
        )}
      </p>
      {error && (
        <div className="text-red-600 text-sm border border-red-300 bg-red-50 p-2 rounded mb-3">
          ⚠ {error}
        </div>
      )}
      <Button
        onClick={handleScreen}
        disabled={screening || !wallet || !signedAccountId}
        className="w-full"
      >
        {screening
          ? "Screening..."
          : wallet && signedAccountId
          ? "Screen This Proposal"
          : "Connect Wallet to Screen"}
      </Button>
    </div>
  );
}
