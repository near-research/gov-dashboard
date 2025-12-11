import { NextApiRequest, NextApiResponse } from "next";
import type { Evaluation } from "@/types/evaluation";
import {
  sanitizeProposalInput,
  verifyNearAuth,
  requestEvaluation,
  respondWithScreeningError,
} from "@/server/screening";
import { createRateLimiter } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { mergeVerificationStatusFromProof } from "@/server/verificationUtils";
import { prefetchVerificationProof } from "@/server/prefetchVerificationProof";

const screenLimiter = createRateLimiter(rateLimitConfig.screen);

/**
 * POST /api/screen
 *
 * Authenticated screening endpoint - evaluates proposals WITHOUT saving.
 * Requires NEAR wallet signature for authentication (NEP-413).
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const origin =
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : undefined);

  const authHeader = req.headers.authorization;
  let verificationResult;
  try {
    ({ result: verificationResult } = await verifyNearAuth(authHeader));
  } catch (error) {
    return respondWithScreeningError(
      res,
      error,
      "Connect your NEAR wallet to evaluate this proposal."
    );
  }

  const nearAddress = verificationResult.accountId;

  // Apply rate limit per NEAR account
  const { allowed, remaining, resetTime } = screenLimiter.check(nearAddress);
  const secondsUntilReset = Math.max(
    0,
    Math.ceil((resetTime - Date.now()) / 1000)
  );
  res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0).toString());
  res.setHeader("X-RateLimit-Limit", screenLimiter.limit.toString());
  res.setHeader("X-RateLimit-Reset", secondsUntilReset.toString());

  if (!allowed) {
    const retryAfter =
      secondsUntilReset || rateLimitConfig.screen.windowMs / 1000;
    res.setHeader("Retry-After", retryAfter.toString());
    return res.status(429).json({
      error: "Too many requests",
      message: `Rate limit exceeded for ${nearAddress}. Please wait ${Math.ceil(
        retryAfter / 60
      )} minutes and try again.`,
      retryAfter,
    });
  }

  const { title, proposal } = req.body;
  let sanitizedTitle: string;
  let sanitizedProposal: string;
  try {
    const sanitized = sanitizeProposalInput(title, proposal);
    sanitizedTitle = sanitized.title;
    sanitizedProposal = sanitized.content;
  } catch (error) {
    return respondWithScreeningError(res, error);
  }

  try {
    const {
      evaluation,
      verification,
      verificationId,
      model,
      proof,
      requestHash,
      responseHash,
      nonce,
    } = await requestEvaluation(sanitizedTitle, sanitizedProposal);

    console.log(
      `[Screen] Evaluation complete for ${nearAddress} - Pass: ${
        evaluation.overallPass
      }, Quality: ${(evaluation.qualityScore * 100).toFixed(0)}%, Attention: ${(
        evaluation.attentionScore * 100
      ).toFixed(0)}%`
    );

    const proofPayload =
      proof ??
      (verificationId
        ? {
            verificationId,
            requestHash,
            responseHash,
            nonce,
          }
        : undefined);

    let remoteProof = null;
    if (
      proofPayload?.verificationId &&
      proofPayload.requestHash &&
      proofPayload.responseHash
    ) {
      remoteProof = await prefetchVerificationProof(origin, {
        verificationId: proofPayload.verificationId,
        model,
        requestHash: proofPayload.requestHash,
        responseHash: proofPayload.responseHash,
        nonce: proofPayload.nonce ?? null,
      });
    }

    const mergedVerification =
      mergeVerificationStatusFromProof(verification, remoteProof) ?? verification;

    return res.status(200).json({
      evaluation,
      authenticatedAs: nearAddress,
      verification: mergedVerification,
      verificationId,
      model,
      proof: proofPayload ?? null,
      remoteProof,
    });
  } catch (error) {
    return respondWithScreeningError(res, error, "Failed to evaluate proposal");
  }
}
