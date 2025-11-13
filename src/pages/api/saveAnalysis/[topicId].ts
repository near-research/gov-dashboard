import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { screeningResults } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { Evaluation } from "@/types/evaluation";
import { getCurrentTopicVersion } from "@/lib/db/revision-utils";
import {
  sanitizeProposalInput,
  verifyNearAuth,
  requestEvaluation,
  respondWithScreeningError,
} from "@/server/screening";

/**
 * POST /api/saveAnalysis/[topicId]
 *
 * Screens a proposal and saves the result to the database.
 *
 * Considerations:
 * - Requires NEP-413 auth token via near-sign-verify
 * - Prevents duplicate screenings per (topicId, revisionNumber) via composite primary key
 * - Always saves results for transparency (pass or fail)
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Extract topicId from URL parameter
  const topicIdParam = req.query.topicId;
  const topicId = Array.isArray(topicIdParam) ? topicIdParam[0] : topicIdParam;

  const { title, content, revisionNumber } = req.body as {
    title?: string;
    content?: string;
    revisionNumber?: number; // Optional - specific revision to screen
  };

  // Validate required inputs
  if (!topicId || typeof topicId !== "string") {
    return res.status(400).json({ error: "Invalid topic ID" });
  }
  if (!title?.trim()) {
    return res.status(400).json({ error: "Title is required" });
  }
  if (!content?.trim()) {
    return res.status(400).json({ error: "Content is required" });
  }

  // Validate revisionNumber if provided
  if (
    revisionNumber !== undefined &&
    (!Number.isInteger(revisionNumber) || revisionNumber < 1)
  ) {
    return res.status(400).json({
      error: "Invalid revision number",
      message: "revisionNumber must be a positive integer",
    });
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
  let verificationResult;
  try {
    ({ result: verificationResult } = await verifyNearAuth(authHeader, {
      validateMessage: (message: string) => {
        const expectedMessage = `Screen proposal ${topicId}`;
        if (message !== expectedMessage) {
          console.error(
            `[Save Analysis] Message mismatch. Expected "${expectedMessage}", received "${message}"`
          );
          return false;
        }
        return true;
      },
    }));
  } catch (error) {
    return respondWithScreeningError(
      res,
      error,
      "Authorization header with Bearer token is required"
    );
  }

  const signerAccountId = verificationResult.accountId;

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
      console.warn(
        `[Save Analysis] Could not fetch current version from Discourse for topic ${topicId}, defaulting to 1`
      );
      versionToScreen = 1;
    }
  }

  // Check for existing screening for this specific revision
  const existing = await db
    .select()
    .from(screeningResults)
    .where(
      and(
        eq(screeningResults.topicId, topicId),
        eq(screeningResults.revisionNumber, versionToScreen)
      )
    )
    .limit(1);

  if (existing?.length) {
    return res.status(409).json({
      error: "Already evaluated",
      message: `Revision ${versionToScreen} of this proposal has already been evaluated by ${existing[0].nearAccount}`,
      version: versionToScreen,
      existingEvaluation: existing[0].evaluation,
    });
  }

  try {
    const evaluation: Evaluation = await requestEvaluation(
      sanitizedTitle,
      sanitizedContent
    );

    // Extract computed scores from evaluation
    const qualityScore = evaluation.qualityScore;
    const attentionScore = evaluation.attentionScore;

    // Save to database with revision number and computed scores
    try {
      await db.insert(screeningResults).values({
        topicId,
        revisionNumber: versionToScreen,
        evaluation,
        title: sanitizedTitle,
        nearAccount: signerAccountId, // Always from verified token
        qualityScore, // NEW: Save computed quality score
        attentionScore, // NEW: Save computed attention score
      });

      console.log(
        `[Save Analysis] ✓ Saved screening for topic ${topicId} revision ${versionToScreen} by ${signerAccountId} (Q: ${qualityScore}, A: ${attentionScore})`
      );
    } catch (dbError: unknown) {
      // Handle duplicate key error (composite primary key violation)
      // Error code 23505 = PostgreSQL unique_violation
      const duplicateViolation =
        typeof dbError === "object" && dbError !== null
          ? ((dbError as { code?: string; constraint?: string }).code ===
              "23505" ||
              (dbError as { code?: string; constraint?: string }).constraint ===
                "screening_results_pkey")
          : false;

      if (duplicateViolation) {
        return res.status(409).json({
          error: "Already evaluated",
          message: `Revision ${versionToScreen} of this proposal has already been evaluated`,
          version: versionToScreen,
        });
      }
      // Re-throw other database errors
      throw dbError;
    }

    return res.status(200).json({
      success: true,
      saved: true,
      passed: evaluation.overallPass,
      evaluation,
      qualityScore,
      attentionScore,
      version: versionToScreen,
      evaluatedBy: signerAccountId,
      message: evaluation.overallPass
        ? `Evaluation passed and saved for revision ${versionToScreen}`
        : `Evaluation failed but saved for revision ${versionToScreen}`,
    });
  } catch (error) {
    return respondWithScreeningError(res, error);
  }
}
