import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import {
  screeningResults,
  type ScreeningResult,
} from "@/lib/db/schema";
import { eq, and, desc, lt } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { z } from "zod";

/**
 * GET /api/getAnalysis/[topicId]
 *
 * Fetches screening results for a specific Discourse topic.
 * Now supports querying specific revisions or getting the latest.
 *
 * Query Parameters:
 * - revisionNumber (optional): Get screening for a specific revision
 * - all (optional): If "true", returns all revisions for the topic
 *
 * Examples:
 * - GET /api/getAnalysis/123 → Returns latest screening
 * - GET /api/getAnalysis/123?revisionNumber=2 → Returns screening for revision 2
 * - GET /api/getAnalysis/123?all=true → Returns all screenings for this topic
 *
 * Public endpoint - no authentication required.
 * Used to display screening badges on proposal pages.
 *
 * Returns:
 * - 200: Screening results found
 * - 404: No screening exists for this topic/revision
 * - 400: Invalid topic ID or revision number
 * - 405: Method not allowed (non-GET requests)
 * - 500: Database error
 */
const querySchema = z.object({
  all: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(/^\d+$/).optional(),
  revisionNumber: z.coerce.number().int().min(1).optional(),
});

type ScreeningPageResult = {
  revisionNumber: number;
  evaluation: ScreeningResult["evaluation"];
  qualityScore: number | null;
  attentionScore: number | null;
  title: string;
  nearAccount: string;
  timestamp: string;
  model: string | null;
};

const formatScreeningRecord = (screening: ScreeningResult): ScreeningPageResult => ({
  revisionNumber: screening.revisionNumber,
  evaluation: screening.evaluation,
  qualityScore: screening.qualityScore ?? null,
  attentionScore: screening.attentionScore ?? null,
  title: screening.title,
  nearAccount: screening.nearAccount,
  timestamp: screening.timestamp.toISOString(),
  model: screening.evaluation.model ?? null,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method !== "GET") {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.METHOD_NOT_ALLOWED,
          "This endpoint only supports GET requests",
          405
        )
      );
    }

    const { topicId } = req.query;
    if (!topicId || typeof topicId !== "string") {
      return respondWithError(
        res,
        new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid topic ID", 400)
      );
    }

    const parsedQuery = querySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          parsedQuery.error.issues
            .map((issue) => issue.message)
            .join("; "),
          400
        )
      );
    }

    const { all, limit, cursor, revisionNumber } = parsedQuery.data;

    if (all === "true") {
      const cursorValue = cursor ? Number(cursor) : undefined;
      if (cursor && Number.isNaN(cursorValue)) {
        return respondWithError(
          res,
          new ApiError(
            ErrorCodes.VALIDATION_ERROR,
            "Invalid cursor value",
            400,
            "Cursor must be a numeric revision number"
          )
        );
      }

      const pageLimit = limit + 1;
      const baseCondition = eq(screeningResults.topicId, topicId);
      const cursorCondition =
        cursorValue !== undefined
          ? and(
              baseCondition,
              lt(screeningResults.revisionNumber, cursorValue)
            )
          : baseCondition;

      const rows = await db
        .select()
        .from(screeningResults)
        .where(cursorCondition)
        .orderBy(desc(screeningResults.revisionNumber))
        .limit(pageLimit);

      if (!rows || rows.length === 0) {
        return respondWithError(
          res,
          new ApiError(
            ErrorCodes.NOT_FOUND,
            "No screening results found",
            404,
            `No screenings exist for topic ${topicId}`
          )
        );
      }

      const hasMore = rows.length > limit;
      const windowed = hasMore ? rows.slice(0, limit) : rows;
      const results = windowed.map(formatScreeningRecord);
      const nextCursor = hasMore
        ? String(results[results.length - 1].revisionNumber)
        : undefined;

      return res.status(200).json({
        topicId,
        results,
        screenings: results,
        hasMore,
        nextCursor,
      });
    }

    if (revisionNumber !== undefined) {
      const result = await db
        .select()
        .from(screeningResults)
        .where(
          and(
            eq(screeningResults.topicId, topicId),
            eq(screeningResults.revisionNumber, revisionNumber)
          )
        )
        .limit(1);

      if (!result || result.length === 0) {
        return respondWithError(
          res,
          new ApiError(
            ErrorCodes.NOT_FOUND,
            "No screening results found",
            404,
            `No screening exists for topic ${topicId} revision ${revisionNumber}`
          )
        );
      }

      return res.status(200).json(formatScreeningRecord(result[0]));
    }

    const latest = await db
      .select()
      .from(screeningResults)
      .where(eq(screeningResults.topicId, topicId))
      .orderBy(desc(screeningResults.revisionNumber))
      .limit(1);

    if (!latest || latest.length === 0) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "No screening results found",
          404,
          `No screening exists for topic ${topicId}`
        )
      );
    }

    return res.status(200).json(formatScreeningRecord(latest[0]));
  } catch (error) {
    logger.error("[getAnalysis] Handler error:", error);
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(
            ErrorCodes.UPSTREAM_ERROR,
            "Failed to fetch screening results",
            500,
            process.env.NODE_ENV === "development" ? String(error) : undefined
          );
    return respondWithError(res, apiError);
  }
}
