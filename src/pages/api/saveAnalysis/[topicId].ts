import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { screeningResults } from "@/lib/db/schema";
import type { Evaluation } from "@/types/evaluation";
import { getCurrentTopicVersion } from "@/lib/db/revision-utils";
import { logger } from "@/lib/logger";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import {
  sanitizeProposalInput,
  verifyNearAuth,
  requestEvaluation,
  respondWithScreeningError,
  ScreeningError,
} from "@/server/screening";

/**
 * POST /api/saveAnalysis/[topicId]
 *
 * Screens a proposal and saves the result to the database.
 *
 * Considerations:
 * - Prevents duplicate screenings per (topicId, revisionNumber) via composite primary key
 * - Always saves results for transparency (pass or fail)
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    throw new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405);
  }

  const origin =
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : undefined);

  // Extract topicId from URL parameter
  const topicIdParam = req.query.topicId;
  const topicId = Array.isArray(topicIdParam) ? topicIdParam[0] : topicIdParam;

  const { title, content, revisionNumber } = req.body as {
    title?: string;
    content?: string;
    revisionNumber?: number; // Optional - specific revision to screen
  };

  try {
    // Validate required inputs
    if (!topicId || typeof topicId !== "string") {
      throw new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid topic ID", 400);
    }
    if (!title?.trim()) {
      throw new ApiError(ErrorCodes.VALIDATION_ERROR, "Title is required", 400);
    }
    if (!content?.trim()) {
      throw new ApiError(ErrorCodes.VALIDATION_ERROR, "Content is required", 400);
    }

    // Validate revisionNumber if provided
    if (
      revisionNumber !== undefined &&
      (!Number.isInteger(revisionNumber) || revisionNumber < 1)
    ) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid revision number",
        400,
        { message: "revisionNumber must be a positive integer" }
      );
    }

    let sanitizedTitle: string;
    let sanitizedContent: string;
    try {
      const sanitized = sanitizeProposalInput(title, content);
      sanitizedTitle = sanitized.title;
      sanitizedContent = sanitized.content;
    } catch (error) {
      return respondWithScreeningError(res, error);
    }

    const authHeader = req.headers.authorization;
    let authVerificationResult: Awaited<
      ReturnType<typeof verifyNearAuth>
    >["result"];
    try {
      const authResponse = await verifyNearAuth(authHeader, {
        validateMessage: (message: string) => {
          const expectedMessage = `Screen proposal ${topicId}`;
          if (message !== expectedMessage) {
            logger.error(
              `[Save Analysis] Message mismatch. Expected "${expectedMessage}", received "${message}"`
            );
            return false;
          }
          return true;
        },
      });
      authVerificationResult = authResponse.result;
    } catch (error) {
      return respondWithScreeningError(
        res,
        error,
        "Authorization header with Bearer token is required"
      );
    }

    if (!authVerificationResult) {
      throw new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to verify Near authentication",
        500
      );
    }

    const signerAccountId = authVerificationResult.accountId;

    // Determine which revision to screen
    let versionToScreen: number;

    if (revisionNumber !== undefined) {
      // Specific revision requested
      versionToScreen = revisionNumber;
    } else {
      // No revision specified - get current version from Discourse
      try {
        versionToScreen = await getCurrentTopicVersion(topicId);
      } catch (error) {
        logger.warn(
          `[Save Analysis] Could not fetch current version from Discourse for topic ${topicId}, defaulting to 1`
        );
        versionToScreen = 1;
      }
    }

    const {
      evaluation,
      verificationResult: evaluationVerificationResult,
      verificationId,
      model,
    } = await requestEvaluation(sanitizedTitle, sanitizedContent);

    const qualityScore = evaluation.qualityScore;
    const attentionScore = evaluation.attentionScore;

    const data = {
      topicId,
      revisionNumber: versionToScreen,
      evaluation,
      title: sanitizedTitle,
      nearAccount: signerAccountId,
      qualityScore,
      attentionScore,
    };

    try {
      await db.insert(screeningResults).values(data);
    } catch (dbError: unknown) {
      if (isDuplicateViolation(dbError)) {
        throw new ApiError(
          ErrorCodes.CONFLICT,
          `Revision ${versionToScreen} of this proposal has already been evaluated`,
          409
        );
      }
      throw dbError;
    }

    logger.debug(
      `[Save Analysis] ✓ Saved screening for topic ${topicId} revision ${versionToScreen} by ${signerAccountId} (Q: ${qualityScore}, A: ${attentionScore})`
    );

    return res.status(200).json({
      success: true,
      saved: true,
      passed: evaluation.overallPass,
      evaluation,
      verificationResult: evaluationVerificationResult,
      verificationId,
      qualityScore,
      attentionScore,
      version: versionToScreen,
      evaluatedBy: signerAccountId,
      model,
      message: evaluation.overallPass
        ? `Evaluation passed and saved for revision ${versionToScreen}`
        : `Evaluation failed but saved for revision ${versionToScreen}`,
    });
  } catch (error) {
    if (error instanceof ScreeningError) {
      return respondWithScreeningError(res, error);
    }

    logger.error("[saveAnalysis] Unexpected error", {
      error: error instanceof Error ? error.message : String(error),
      topicId: req.query.topicId,
    });

    return respondWithError(
      res,
      error instanceof ApiError
        ? error
        : new ApiError(
            ErrorCodes.INTERNAL_ERROR,
            "Failed to save screening result",
            500,
            { details: error instanceof Error ? error.message : undefined }
          )
    );
  }
}

const isDuplicateViolation = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const typed = error as { code?: string; constraint?: string };
  return (
    typed.code === "23505" ||
    typed.constraint === "screening_results_pkey"
  );
};
