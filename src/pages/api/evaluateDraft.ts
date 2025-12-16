import { NextApiRequest, NextApiResponse } from "next";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata, VerificationStatus } from "@/lib/near-ai";
import {
  sanitizeProposalInput,
  verifyNearAuth,
  requestEvaluation,
  respondWithScreeningError,
} from "@/server/screening";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

/**
 * POST /api/evaluateDraft
 *
 * Public screening endpoint - evaluates proposals WITHOUT saving.
 * Supports both authenticated (NEAR wallet) and anonymous users.
 * Rate limiting applies uniformly (5 per 15 minutes) based on NEAR account
 * when signed in, or IP address when anonymous.
 */

const evaluateDraftLimiter = createRateLimiter(rateLimitConfig.evaluateDraft);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405)
    );
  }

  // Check if user is authenticated (optional for this endpoint)
  const authHeader = req.headers.authorization;
  let isAuthenticated = false;
  let accountId: string | undefined;

  if (authHeader) {
    try {
      const { result } = await verifyNearAuth(authHeader);
      isAuthenticated = true;
      accountId = result.accountId;
    } catch (error) {
      // Authentication failed, treat as anonymous
      // Don't return error - allow anonymous usage with rate limit
      logger.debug(
        "[EvaluateDraft] Auth verification failed, treating as anonymous"
      );
    }
  }

  const clientId = getClientIdentifier(req);
  const rateLimitKey =
    isAuthenticated && accountId ? `account:${accountId}` : `ip:${clientId}`;
  const { allowed, remaining, resetTime } =
    evaluateDraftLimiter.check(rateLimitKey);
  const secondsUntilReset = Math.max(
    0,
    Math.ceil((resetTime - Date.now()) / 1000)
  );

  res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0).toString());
  res.setHeader("X-RateLimit-Limit", evaluateDraftLimiter.limit.toString());
  res.setHeader("X-RateLimit-Reset", secondsUntilReset.toString());

  if (!allowed) {
    const retryAfter =
      secondsUntilReset || rateLimitConfig.evaluateDraft.windowMs / 1000;
    res.setHeader("Retry-After", retryAfter.toString());
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.RATE_LIMITED,
        `You've reached the limit of ${
          rateLimitConfig.evaluateDraft.maxRequests
        } evaluations in ${Math.round(
          rateLimitConfig.evaluateDraft.windowMs / 60000
        )} minutes. Please wait ${Math.ceil(retryAfter / 60)} minutes and try again.`,
        429,
        { retryAfter, scope: isAuthenticated ? "account" : "ip" }
      )
    );
  }

  // Sanitize and validate input
  const { title, content } = req.body;
  let sanitizedTitle: string;
  let sanitizedContent: string;

  try {
    const sanitized = sanitizeProposalInput(title, content);
    sanitizedTitle = sanitized.title;
    sanitizedContent = sanitized.content;
  } catch (error) {
    return respondWithScreeningError(res, error);
  }

  // Request evaluation from AI
  try {
    const { evaluation, verificationResult, verificationId, model } =
      await requestEvaluation(sanitizedTitle, sanitizedContent);

    const logPrefix = isAuthenticated
      ? `[EvaluateDraft] ${accountId}`
      : `[EvaluateDraft] Anonymous`;

    logger.debug(
      `${logPrefix} - Pass: ${evaluation.overallPass}, Quality: ${(
        evaluation.qualityScore * 100
      ).toFixed(0)}%, Attention: ${(evaluation.attentionScore * 100).toFixed(
        0
      )}%`
    );

    let evaluationVerification: VerificationMetadata | undefined;
    if (verificationResult || verificationId) {
      const status: VerificationStatus = verificationResult
        ? verificationResult.verified
          ? "verified"
          : "failed"
        : "pending";
      evaluationVerification = {
        source: "near-ai-cloud",
        status,
        chatId: verificationResult?.chatId ?? verificationId ?? undefined,
        messageId: verificationResult?.chatId ?? verificationId ?? undefined,
        requestHash: verificationResult?.requestHash ?? undefined,
        responseHash: verificationResult?.responseHash ?? undefined,
        error: verificationResult?.error ?? undefined,
      };
    }

    return res.status(200).json({
      evaluation,
      authenticatedAs: accountId,
      verification: evaluationVerification,
      verificationId,
      model,
    });
  } catch (error) {
    return respondWithScreeningError(res, error, "Failed to evaluate proposal");
  }
}
