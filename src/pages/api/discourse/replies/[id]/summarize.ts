import type { NextApiRequest, NextApiResponse } from "next";
import { replyCache, CacheKeys } from "@/utils/cache-utils";
import { buildReplySummaryPrompt } from "@/lib/prompts/summarizeReply";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { servicesConfig } from "@/config/services";
import type {
  DiscourseActionSummary,
  DiscoursePost,
  DiscourseTopic,
} from "@/types/discourse";
import type { ApiErrorResponse } from "@/types/api";
import type { ReplySummaryResponse } from "@/components/proposal/types/summaries";
import { getNearAIClient } from "@/lib/near-ai";
import { runSummaryFlow } from "@/lib/near-ai/summarize";
import { NEAR_AI_MODELS } from "@/utils/model-utils";
import { logger } from "@/lib/logger";
import { createSummaryVerificationId } from "@/server/summaryVerification";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";

const replyLimiter = createRateLimiter(rateLimitConfig.replySummary);
const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

/**
 * POST /api/discourse/replies/[id]/summarize
 *
 * Generates an AI summary of a SINGLE REPLY.
 * Very brief, focused on core message and position.
 *
 * Security:
 * - Public endpoint (no auth required)
 * - Rate limited to prevent abuse
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReplySummaryResponse | ApiErrorResponse>
) {
  if (req.method !== "POST") {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405)
    );
  }

  const { id: replyId } = req.query;

  if (!replyId || typeof replyId !== "string") {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid reply ID", 400)
    );
  }

  const clientId = getClientIdentifier(req);
  const origin =
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : undefined);
  const { allowed, remaining, resetTime } = replyLimiter.check(clientId);
  const secondsUntilReset = Math.max(
    0,
    Math.ceil((resetTime - Date.now()) / 1000)
  );

  res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0).toString());
  res.setHeader("X-RateLimit-Limit", replyLimiter.limit.toString());
  res.setHeader("X-RateLimit-Reset", secondsUntilReset.toString());

  if (!allowed) {
    const retryAfter =
      secondsUntilReset || rateLimitConfig.replySummary.windowMs / 1000;
    res.setHeader("Retry-After", retryAfter.toString());
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.RATE_LIMITED,
        `You've reached the limit of ${
          rateLimitConfig.replySummary.maxRequests
        } reply summaries in ${Math.round(
          rateLimitConfig.replySummary.windowMs / 60000
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
    const cacheKey = CacheKeys.reply(replyId);
    const cached = replyCache.get(cacheKey);

    if (cached) {
      return res.status(200).json({
        ...cached,
        cached: true,
        cacheAge: Math.round((Date.now() - cached.generatedAt) / 1000),
      });
    }

    // ===================================================================
    // FETCH FROM DISCOURSE (NO AUTH)
    // ===================================================================
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Direct post fetch (primary method)
    const postResponse = await fetch(`${DISCOURSE_URL}/posts/${replyId}.json`, {
      headers,
    });

    if (!postResponse.ok) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "Reply not found",
          postResponse.status,
          { status: postResponse.status }
        )
      );
    }

    const replyPost: DiscoursePost = await postResponse.json();

    // Strip HTML
    const stripHtml = (html: string): string => {
      return html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    // ===================================================================
    // FETCH PARENT POST IF THIS IS A REPLY TO ANOTHER POST
    // ===================================================================
    let parentPostContent: string | null = null;
    let parentPostAuthor: string | null = null;

    if (replyPost.reply_to_post_number) {
      try {
        // Fetch the topic to get all posts
        const topicResponse = await fetch(
          `${DISCOURSE_URL}/t/${replyPost.topic_id}.json`,
          { headers }
        );

        if (topicResponse.ok) {
          const topicData: DiscourseTopic = await topicResponse.json();
          const posts = topicData.post_stream?.posts || [];

          // Find the parent post by post_number
          const parentPost = posts.find(
            (p: DiscoursePost) =>
              p.post_number === replyPost.reply_to_post_number
          );

          if (parentPost) {
            parentPostContent = stripHtml(parentPost.cooked);
            parentPostAuthor = parentPost.username;

            // Truncate parent post if very long (keep first 500 chars)
            const MAX_PARENT_LENGTH = 500;
            if (parentPostContent.length > MAX_PARENT_LENGTH) {
              parentPostContent =
                parentPostContent.substring(0, MAX_PARENT_LENGTH) +
                "\n[... parent post truncated ...]";
            }
          }
        }
      } catch (error) {
        logger.error(`[Reply Summary] Failed to fetch parent post:`, error);
        // Continue without parent context if fetch fails
      }
    }

    const replyContent = stripHtml(replyPost.cooked);

    // Truncate if needed (though replies are usually shorter)
    const MAX_LENGTH = 4000;
    const truncatedContent =
      replyContent.length > MAX_LENGTH
        ? replyContent.substring(0, MAX_LENGTH) + "\n\n[... truncated ...]"
        : replyContent;

    // ===================================================================
    // BUILD CONTENT WITH PARENT POST CONTEXT
    // ===================================================================
    let contentWithContext = truncatedContent;

    if (parentPostContent && parentPostAuthor) {
      contentWithContext = `**REPLYING TO (Post #${replyPost.reply_to_post_number} by @${parentPostAuthor}):**

${parentPostContent}

---

**THIS REPLY:**

${truncatedContent}`;
    }

    // ===================================================================
    // GENERATE AI SUMMARY USING PROMPT BUILDER
    // ===================================================================
    const client = getNearAIClient();
    const verificationId = createSummaryVerificationId();

    // Get like count for engagement context
    const likeCount =
      replyPost.actions_summary?.find((a: DiscourseActionSummary) => a.id === 2)
        ?.count || 0;

    // Use the prompt builder function
    const prompt = buildReplySummaryPrompt(
      {
        username: replyPost.username,
        post_number: replyPost.post_number,
        reply_to_post_number: replyPost.reply_to_post_number ?? undefined,
        reply_to_user: replyPost.reply_to_user ?? undefined,
      },
      likeCount,
      contentWithContext
    );

    const model = NEAR_AI_MODELS.DEEPSEEK_V3_1;
    const { summary, verification: verificationData } = await runSummaryFlow({
      client,
      origin,
      verificationId,
      model,
      userPrompt: prompt,
      temperature: 0.3,
      maxTokens: 250,
    });

    if (!summary) {
      throw new Error("Empty summary returned from AI");
    }

    // ===================================================================
    // BUILD RESPONSE
    // ===================================================================
    const replyTo =
      replyPost.reply_to_user && replyPost.reply_to_post_number
        ? {
            username: replyPost.reply_to_user.username,
            postNumber: replyPost.reply_to_post_number,
          }
        : replyPost.reply_to_post_number
        ? { postNumber: replyPost.reply_to_post_number }
        : null;

    const response: ReplySummaryResponse = {
      success: true,
      summary,
      replyId,
      author: replyPost.username,
      postNumber: replyPost.post_number,
      createdAt: replyPost.created_at,
      likeCount: likeCount,
      replyTo,
      parentPostIncluded: !!parentPostContent,
      truncated: replyContent.length > MAX_LENGTH,
      generatedAt: Date.now(), // For cache age tracking
      cached: false,
      model,
      verification: verificationData.verificationMetadata,
      verificationResult: verificationData.verificationResult,
      verificationId,
      proof: verificationData.proof,
    };

    replyCache.set(cacheKey, response);
    return res.status(200).json(response);
  } catch (error: unknown) {
    logger.error("[Reply Summary] Error:", error);
    const details =
      error instanceof Error && process.env.NODE_ENV === "development"
        ? error.message
        : undefined;
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to generate reply summary",
        500,
        details
      )
    );
  }
}
