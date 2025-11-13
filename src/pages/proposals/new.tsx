"use client";

import { useState } from "react";
import { useNear } from "@/hooks/useNear";
import type { Evaluation } from "@/types/evaluation";
import { ProposalForm } from "@/components/proposal/ProposalForm";
import { ScreeningResults } from "@/components/proposal/screening/ScreeningResults";
import { ScreeningBadge } from "@/components/proposal/screening/ScreeningBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  buildRateLimitMessage,
  extractRateLimitInfo,
} from "@/utils/rateLimitHelpers";

export default function NewProposalPage() {
  const { signedAccountId } = useNear();
  const [title, setTitle] = useState("");
  const [proposal, setProposal] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
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

    setLoading(true);
    setError("");
    setResult(null);

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
          setError(
            buildRateLimitMessage(response, errorData?.retryAfter ?? null)
          );
          return;
        }

        throw new Error(
          errorData?.error || `API request failed: ${response.status}`
        );
      }

      const data: { evaluation: Evaluation } = await response.json();
      setResult(data.evaluation);
    } catch (err: unknown) {
      console.error("Evaluation error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to evaluate proposal";
      setError(message);
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
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
