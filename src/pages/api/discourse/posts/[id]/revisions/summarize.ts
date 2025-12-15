import type { NextApiRequest, NextApiResponse } from "next";
import { revisionCache, CacheKeys } from "@/utils/cache-utils";
import { buildRevisionAnalysisPrompt } from "@/lib/prompts/summarizeRevisions";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { servicesConfig } from "@/config/services";
import type {
  DiscoursePost,
  DiscourseRevision,
  RevisionBodyChange,
  RevisionTitleChange,
} from "@/types/discourse";
import type { ApiErrorResponse } from "@/types/api";
import type { PostRevisionSummaryResponse } from "@/components/proposal/types/summaries";
import { getNearAIClient } from "@/lib/near-ai";
import { runSummaryFlow } from "@/lib/near-ai/summarize";
import { logger } from "@/lib/logger";
import { createSummaryVerificationId } from "@/server/summaryVerification";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";

const postRevisionLimiter = createRateLimiter(rateLimitConfig.postRevisions);
const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

/**
 * POST /api/discourse/posts/[id]/revisions/summarize
 *
 * Generates an AI summary of ALL REVISIONS to a post.
 * Analyzes what changed, why, and the significance of edits.
 *
 * CACHING: 15 minute TTL (revisions don't change once made, but new ones can be added)
 *
 * Security:
 * - Public endpoint (no auth required)
 * - Rate limited to prevent abuse
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PostRevisionSummaryResponse | ApiErrorResponse>
) {
  if (req.method !== "POST") {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405)
    );
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid post ID", 400)
    );
  }

  const clientId = getClientIdentifier(req);
  const origin =
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : undefined);
  const { allowed, remaining, resetTime } = postRevisionLimiter.check(clientId);
  const secondsUntilReset = Math.max(
    0,
    Math.ceil((resetTime - Date.now()) / 1000)
  );

  res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0).toString());
  res.setHeader("X-RateLimit-Limit", postRevisionLimiter.limit.toString());
  res.setHeader("X-RateLimit-Reset", secondsUntilReset.toString());

  if (!allowed) {
    const retryAfter =
      secondsUntilReset || rateLimitConfig.postRevisions.windowMs / 1000;
    res.setHeader("Retry-After", retryAfter.toString());
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.RATE_LIMITED,
        `You've reached the limit of ${
          rateLimitConfig.postRevisions.maxRequests
        } post revision summaries in ${Math.round(
          rateLimitConfig.postRevisions.windowMs / 60000
        )} minutes. Please wait ${Math.ceil(retryAfter / 60)} minutes and try again.`,
        429,
        { retryAfter }
      )
    );
  }

  try {
    // ===================================================================
    // CACHE CHECK
    // ===================================================================
    const cacheKey = CacheKeys.postRevision(id);
    const cached = revisionCache.get(cacheKey);

    if (cached) {
      return res.status(200).json({
        ...cached,
        cached: true,
        cacheAge: Math.round((Date.now() - cached.generatedAt) / 1000),
      });
    }

    const model = "deepseek-ai/DeepSeek-V3.1";

    // ===================================================================
    // FETCH FROM DISCOURSE (NO AUTH)
    // ===================================================================
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Get the post to check version
    const postResponse = await fetch(`${DISCOURSE_URL}/posts/${id}.json`, {
      headers,
    });

    if (!postResponse.ok) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "Post not found",
          postResponse.status,
          { status: postResponse.status }
        )
      );
    }

    const postData: DiscoursePost = await postResponse.json();
    const version = postData.version || 1;

    // If version is 1, no edits have been made
    if (version <= 1) {
      const emptySummary: PostRevisionSummaryResponse = {
        success: true,
        summary: "This post has not been edited. No revisions to analyze.",
        postId: id,
        author: postData.username,
        currentVersion: version,
        totalRevisions: 0,
        revisions: [],
        truncated: false,
        generatedAt: Date.now(),
        cached: false,
        model,
      };
      return res.status(200).json(emptySummary);
    }

    // Fetch all revisions (they start at version 2)
    const revisions: DiscourseRevision[] = [];
    for (let i = 2; i <= version; i++) {
      try {
        const revUrl = `${DISCOURSE_URL}/posts/${id}/revisions/${i}.json`;
        const revResponse = await fetch(revUrl, { headers });

        if (revResponse.ok) {
          const revData = await revResponse.json();
          revisions.push({
            version: revData.current_version || i,
            created_at: revData.created_at,
            username: revData.username,
            edit_reason: revData.edit_reason || "",
            body_changes: revData.body_changes,
            title_changes: revData.title_changes,
          });
        }
      } catch (err) {
        logger.error(`Error fetching revision ${i}:`, err);
        // Continue fetching other revisions
      }
    }

    if (revisions.length === 0) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.UPSTREAM_ERROR,
          "Could not fetch revision data",
          404
        )
      );
    }

    // ===================================================================
    // PREPARE REVISION DATA FOR AI
    // ===================================================================
    const stripHtml = (html: string): string => {
      return html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    // Build a comprehensive revision timeline
    const revisionTimeline = revisions
      .map((rev, index) => {
        const parts = [`**Revision ${index + 1}** (Version ${rev.version})`];
        parts.push(
          `- **Edited by:** @${rev.username} on ${new Date(
            rev.created_at
          ).toLocaleString()}`
        );

        if (rev.edit_reason) {
          parts.push(`- **Reason:** ${rev.edit_reason}`);
        }

        // Add title changes if present
        if (rev.title_changes?.previous && rev.title_changes?.current) {
          parts.push(`- **Title Changed:**`);
          parts.push(`  - FROM: "${rev.title_changes.previous}"`);
          parts.push(`  - TO: "${rev.title_changes.current}"`);
        }

        // Add body changes
        if (rev.body_changes?.inline) {
          const cleanDiff = stripHtml(rev.body_changes.inline);
          // Truncate very long diffs
          const truncatedDiff =
            cleanDiff.length > 1000
              ? cleanDiff.substring(0, 1000) + "\n[... diff truncated ...]"
              : cleanDiff;
          parts.push(`- **Content Changes:**\n${truncatedDiff}`);
        }

        return parts.join("\n");
      })
      .join("\n\n---\n\n");

    // Truncate if needed
    const MAX_LENGTH = 10000;
    const truncatedTimeline =
      revisionTimeline.length > MAX_LENGTH
        ? revisionTimeline.substring(0, MAX_LENGTH) +
          "\n\n[... additional revisions truncated ...]"
        : revisionTimeline;

    // ===================================================================
    // GENERATE AI SUMMARY USING PROMPT BUILDER
    // ===================================================================
    const client = getNearAIClient();
    const verificationId = createSummaryVerificationId();

    // Use the prompt builder function
    const prompt = buildRevisionAnalysisPrompt(
      id,
      { username: postData.username },
      revisions,
      version,
      truncatedTimeline
    );

    const { summary, verification: verificationData } = await runSummaryFlow({
      client,
      origin,
      verificationId,
      model,
      userPrompt: prompt,
      temperature: 0.4,
      maxTokens: 800,
    });

    if (!summary) {
      throw new Error("Empty summary returned from AI");
    }

    // ===================================================================
    // BUILD RESPONSE
    // ===================================================================
    const response: PostRevisionSummaryResponse = {
      success: true,
      summary,
      postId: id,
      author: postData.username,
      currentVersion: version,
      totalRevisions: revisions.length,
      revisions: revisions.map((rev) => ({
        version: rev.version,
        editedBy: rev.username,
        editedAt: rev.created_at,
        editReason: rev.edit_reason || null,
        hasTitleChange: !!(
          rev.title_changes?.previous && rev.title_changes?.current
        ),
        hasBodyChange: !!rev.body_changes?.inline,
      })),
      truncated: revisionTimeline.length > MAX_LENGTH,
      generatedAt: Date.now(),
      cached: false,
      model,
      verification: verificationData.verificationMetadata,
      verificationResult: verificationData.verificationResult,
      verificationId,
      proof: verificationData.proof,
    };

    revisionCache.set(cacheKey, response);
    return res.status(200).json(response);
  } catch (error: unknown) {
    logger.error("Revision summary error:", error);
    const details =
      error instanceof Error && process.env.NODE_ENV === "development"
        ? error.message
        : undefined;
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to generate revision summary",
        500,
        details
      )
    );
  }
}
