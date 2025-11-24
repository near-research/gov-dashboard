"use client";

import { useState } from "react";
import { useNear } from "@/hooks/useNear";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";
import { ProposalForm } from "@/components/proposal/ProposalForm";
import { ScreeningBadge } from "@/components/proposal/screening/ScreeningBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  buildRateLimitMessage,
  extractRateLimitInfo,
} from "@/utils/rateLimitHelpers";
import { useGovernanceAnalytics } from "@/lib/analytics";

export default function NewProposalPage() {
  const { signedAccountId } = useNear();
  const track = useGovernanceAnalytics();

  const [title, setTitle] = useState("");
  const [proposal, setProposal] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
  const [verificationMeta, setVerificationMeta] =
    useState<VerificationMetadata | null>(null);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [expectations, setExpectations] = useState<{
    arch?: string | null;
    deviceCertHash?: string | null;
    rimHash?: string | null;
    ueid?: string | null;
    measurements?: string[] | null;
  } | null>(null);
  const [remainingEvaluations, setRemainingEvaluations] = useState<
    number | null
  >(null);
  const [rateLimitResetSeconds, setRateLimitResetSeconds] = useState<
    number | null
  >(null);

  const evaluateProposal = async () => {
    if (!title.trim() || !proposal.trim()) {
      setError("Please enter both title and proposal");
      return;
    }

    // track start
    track("draft_evaluation_started", {
      props: {
        content_length: proposal.trim().length,
      },
    });

    setLoading(true);
    setError("");
    setResult(null);
    setVerificationMeta(null);
    setVerificationId(null);
    setModel(null);
    setExpectations(null);

    try {
      const response = await fetch("/api/evaluateDraft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, content: proposal }),
      });

      const rateLimit = extractRateLimitInfo(response);
      setRemainingEvaluations(
        typeof rateLimit.remaining === "number" ? rateLimit.remaining : null
      );
      setRateLimitResetSeconds(rateLimit.resetSeconds);

      if (!response.ok) {
        let errorData: { error?: string; retryAfter?: number } | null = null;
        try {
          errorData = await response.json();
        } catch {
          // ignore malformed JSON
        }

        if (response.status === 429) {
          track("draft_evaluation_rate_limited", {
            props: {
              remaining: rateLimit.remaining ?? null,
              reset_seconds: rateLimit.resetSeconds ?? null,
            },
          });

          setError(
            buildRateLimitMessage(response, errorData?.retryAfter ?? null)
          );
          return;
        }

        throw new Error(
          errorData?.error || `API request failed: ${response.status}`
        );
      }

      const data: {
        evaluation: Evaluation;
        verification?: VerificationMetadata | null;
        verificationId?: string | null;
        model?: string | null;
        expectations?: {
          arch?: string | null;
          deviceCertHash?: string | null;
          rimHash?: string | null;
          ueid?: string | null;
          measurements?: string[] | null;
        } | null;
        expectationsFetchFailed?: boolean;
      } = await response.json();

      setResult(data.evaluation);
      setVerificationMeta(data.verification ?? null);
      setVerificationId(
        data.verificationId ?? data.verification?.messageId ?? null
      );
      setModel(data.model ?? null);
      setExpectations(data.expectations ?? null);

      if (data.expectationsFetchFailed) {
        console.warn(
          "[NewProposal] Hardware expectations unavailable - client-side verification may be limited. Server-side verification will still validate the proof."
        );
      }

      // track success
      track("draft_evaluation_succeeded", {
        props: {
          overall_pass: data.evaluation.overallPass,
          quality_score: data.evaluation.qualityScore,
          model: data.model ?? "unknown",
          has_verification: Boolean(data.verification),
        },
      });
    } catch (err: unknown) {
      console.error("Evaluation error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to evaluate proposal";
      setError(message);

      // track failure
      track("draft_evaluation_failed", {
        props: {
          message: message.slice(0, 120),
        },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">
        <div className="space-y-3 text-center">
          <h1 className="text-3xl font-semibold">New Proposal</h1>
          <p className="text-muted-foreground">
            Use NEAR AI to privately check against established criteria.
          </p>
        </div>

        {/* Rate limit info */}
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

        {error && (
          <Alert className="border-red-500 bg-red-50 text-red-900">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-lg border p-6 bg-card">
          <ProposalForm
            title={title}
            proposal={proposal}
            onTitleChange={setTitle}
            onProposalChange={setProposal}
            onSubmit={evaluateProposal}
            loading={loading}
          />
        </div>

        {result && (
          <>
            {result.overallPass ? (
              <Alert className="border-green-500 bg-green-50 text-green-900">
                <AlertDescription>
                  Your proposal is ready to publish to Discourse.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-yellow-500 bg-yellow-50 text-yellow-900">
                <AlertDescription>
                  Your proposal needs improvement. Review the feedback below,
                  make changes, and screen it again.
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-3">
              <ScreeningBadge
                screening={{
                  evaluation: result,
                  title: title || "Draft Proposal",
                  nearAccount: signedAccountId || "Anonymous",
                  timestamp: new Date().toISOString(),
                  revisionNumber: 1,
                  qualityScore: result.qualityScore,
                  attentionScore: result.attentionScore,
                  model: model ?? undefined,
                }}
                verification={verificationMeta ?? undefined}
                verificationId={verificationId ?? undefined}
                nonce={verificationMeta?.nonce ?? undefined}
                expectedArch={expectations?.arch ?? undefined}
                expectedDeviceCertHash={
                  expectations?.deviceCertHash ?? undefined
                }
                expectedRimHash={expectations?.rimHash ?? undefined}
                expectedUeid={expectations?.ueid ?? undefined}
                expectedMeasurements={expectations?.measurements ?? undefined}
                autoFetchProof
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
