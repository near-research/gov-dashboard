import { NextApiRequest, NextApiResponse } from "next";
import type { Evaluation } from "@/types/evaluation";
import {
  sanitizeProposalInput,
  verifyNearAuth,
  requestEvaluation,
  respondWithScreeningError,
} from "@/server/screening";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";

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
    return res.status(405).json({ error: "Method not allowed" });
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
      console.log(
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
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: `You've reached the limit of ${
        rateLimitConfig.evaluateDraft.maxRequests
      } evaluations in ${Math.round(
        rateLimitConfig.evaluateDraft.windowMs / 60000
      )} minutes. Please wait ${Math.ceil(
        retryAfter / 60
      )} minutes and try again.`,
      retryAfter,
      scope: isAuthenticated ? "account" : "ip",
    });
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
    const evaluation: Evaluation = await requestEvaluation(
      sanitizedTitle,
      sanitizedContent
    );

    const logPrefix = isAuthenticated
      ? `[EvaluateDraft] ${accountId}`
      : `[EvaluateDraft] Anonymous`;

    console.log(
      `${logPrefix} - Pass: ${evaluation.overallPass}, Quality: ${(
        evaluation.qualityScore * 100
      ).toFixed(0)}%, Attention: ${(evaluation.attentionScore * 100).toFixed(
        0
      )}%`
    );

    return res.status(200).json({
      evaluation,
      authenticatedAs: accountId,
    });
  } catch (error) {
    return respondWithScreeningError(res, error, "Failed to evaluate proposal");
  }
}
