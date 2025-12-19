import { useCallback, useState } from "react";
import type { GovernanceTrackFn } from "@/lib/analytics";
import type { VerificationMetadata } from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";
import type { ProposalEditorAction, ProposalState } from "@/components/editor/ProposalEditorContext";
import { proposalEditorActions } from "@/components/editor/ProposalEditorContext";
import { buildRateLimitMessage, extractRateLimitInfo } from "@/utils/rateLimitHelpers";
import { logger } from "@/lib/logger";

type UseDraftEvaluationParams = {
  localTitle: string;
  localContent: string;
  dispatch: React.Dispatch<ProposalEditorAction>;
  track: GovernanceTrackFn;
  setEvaluationVerification: (v?: VerificationMetadata) => void;
  setEvaluationChatId: (id?: string) => void;
};

type UseDraftEvaluationState = {
  remainingEvaluations: number | null;
  rateLimitResetSeconds: number | null;
  evaluationError: string;
  evalLoading: boolean;
  evaluateDraft: () => Promise<void>;
};

export function useDraftEvaluation({
  localTitle,
  localContent,
  dispatch,
  track,
  setEvaluationVerification,
  setEvaluationChatId,
}: UseDraftEvaluationParams): UseDraftEvaluationState {
  const [remainingEvaluations, setRemainingEvaluations] = useState<number | null>(null);
  const [rateLimitResetSeconds, setRateLimitResetSeconds] = useState<number | null>(null);
  const [evaluationError, setEvaluationError] = useState("");
  const [evalLoading, setEvalLoading] = useState(false);

  const validateInputs = useCallback(() => {
    if (!localTitle.trim() || !localContent.trim()) {
      setEvaluationError("Please enter both title and proposal content.");
      return false;
    }
    return true;
  }, [localContent, localTitle]);

  const resetEvaluationState = useCallback(() => {
    setEvalLoading(true);
    setEvaluationError("");
    setRemainingEvaluations(null);
    setRateLimitResetSeconds(null);
  }, []);

  const trackStart = useCallback(() => {
    track("draft_evaluation_started", {
      props: {
        content_length: localContent.trim().length,
      },
    });
  }, [localContent, track]);

  const sendEvaluationRequest = useCallback(async () => {
    const response = await fetch("/api/evaluateDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: localTitle,
        content: localContent,
      }),
    });
    console.log("[Screen] API response:", response);

    const rateLimit = extractRateLimitInfo(response);
    setRemainingEvaluations(typeof rateLimit.remaining === "number" ? rateLimit.remaining : null);
    setRateLimitResetSeconds(rateLimit.resetSeconds);
    return { response, rateLimit };
  }, [localContent, localTitle]);

  const handleRateLimit = useCallback(
    async (response: Response, rateLimit: ReturnType<typeof extractRateLimitInfo>) => {
      track("draft_evaluation_rate_limited", {
        props: {
          remaining: rateLimit.remaining ?? null,
          reset_seconds: rateLimit.resetSeconds ?? null,
        },
      });

      const errorData = await response.json().catch(() => null);
      const retryAfter = errorData?.retryAfter ?? null;
      setEvaluationError(buildRateLimitMessage(response, retryAfter));
    },
    [track]
  );

  const parseEvaluationResponse = useCallback(async (response: Response) => {
    return response.json() as Promise<{
      evaluation: Evaluation;
      verification?: VerificationMetadata | null;
      verificationId?: string | null;
    }>;
  }, []);

  const applyEvaluationResult = useCallback(
    (data: {
      evaluation: Evaluation;
      verification?: VerificationMetadata | null;
      verificationId?: string | null;
    }) => {
      console.log("[Screen] Updating state with:", data);
      dispatch(
        proposalEditorActions.updateProposal((prev: ProposalState) => ({
          ...prev,
          evaluation: data.evaluation,
        }))
      );
      setEvaluationVerification(data.verification ?? undefined);
      setEvaluationChatId(data.verificationId ?? data.verification?.messageId ?? undefined);
    },
    [dispatch, setEvaluationChatId, setEvaluationVerification]
  );

  const trackSuccess = useCallback(
    (data: { evaluation: Evaluation; verification?: VerificationMetadata | null }) => {
      track("draft_evaluation_succeeded", {
        props: {
          overall_pass: data.evaluation.overallPass,
          quality_score: data.evaluation.qualityScore,
          model: "unknown",
          has_verification: Boolean(data.verification),
        },
      });
    },
    [track]
  );

  const handleUnexpectedError = useCallback(
    (err: unknown) => {
      logger.error("Evaluation error:", err);
      const message = err instanceof Error ? err.message : "Failed to evaluate proposal";
      setEvaluationError(message);
      track("draft_evaluation_failed", {
        props: {
          message: message.slice(0, 120),
        },
      });
    },
    [track]
  );

  const evaluateDraft = useCallback(async () => {
    if (!validateInputs()) return;
    resetEvaluationState();
    trackStart();

    try {
      const { response, rateLimit } = await sendEvaluationRequest();
      if (!response.ok) {
        if (response.status === 429) {
          await handleRateLimit(response, rateLimit);
          return;
        }
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `API request failed: ${response.status}`);
      }

      const data = await parseEvaluationResponse(response);
      applyEvaluationResult(data);
      trackSuccess(data);
    } catch (err: unknown) {
      handleUnexpectedError(err);
    } finally {
      setEvalLoading(false);
    }
  }, [
    applyEvaluationResult,
    handleUnexpectedError,
    handleRateLimit,
    parseEvaluationResponse,
    resetEvaluationState,
    sendEvaluationRequest,
    trackStart,
    trackSuccess,
    validateInputs,
  ]);

  return {
    remainingEvaluations,
    rateLimitResetSeconds,
    evaluationError,
    evalLoading,
    evaluateDraft,
  };
}
