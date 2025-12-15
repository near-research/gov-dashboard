import type { NextApiRequest, NextApiResponse } from "next";
import { discussionCache, CacheKeys } from "@/utils/cache-utils";
import { buildDiscussionSummaryPrompt } from "@/lib/prompts/summarizeDiscussion";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { servicesConfig } from "@/config/services";
import type {
  DiscourseActionSummary,
  DiscoursePost,
  DiscourseTopic,
} from "@/types/discourse";
import type { ApiErrorResponse } from "@/types/api";
import type { DiscussionSummaryResponse } from "@/components/proposal/types/summaries";
import { getNearAIClient } from "@/lib/near-ai";
import { runSummaryFlow } from "@/lib/near-ai/summarize";
import { logger } from "@/lib/logger";
import { createSummaryVerificationId } from "@/server/summaryVerification";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";

const discussionLimiter = createRateLimiter(rateLimitConfig.discussionSummary);
const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

interface ReplyWithEngagement extends DiscoursePost {
  likeCount: number;
}

/**
 * POST /api/discourse/topics/[id]/summarize
 *
 * Generates an AI summary of a DISCUSSION (all replies to a topic).
 * Analyzes community sentiment and key points from replies.
 *
 * CACHING: 5 minute TTL (discussions are active and change frequently)
 *
 * Security:
 * - Public endpoint (no auth required)
 * - Rate limited to prevent abuse
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DiscussionSummaryResponse | ApiErrorResponse>
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
      new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid topic ID", 400)
    );
  }

  const clientId = getClientIdentifier(req);
  const origin =
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : undefined);
  const { allowed, remaining, resetTime } = discussionLimiter.check(clientId);
  const secondsUntilReset = Math.max(
    0,
    Math.ceil((resetTime - Date.now()) / 1000)
  );

  res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0).toString());
  res.setHeader("X-RateLimit-Limit", discussionLimiter.limit.toString());
  res.setHeader("X-RateLimit-Reset", secondsUntilReset.toString());

  if (!allowed) {
    const retryAfter =
      secondsUntilReset || rateLimitConfig.discussionSummary.windowMs / 1000;
    res.setHeader("Retry-After", retryAfter.toString());
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.RATE_LIMITED,
        `You've reached the limit of ${
          rateLimitConfig.discussionSummary.maxRequests
        } discussion summaries in ${Math.round(
          rateLimitConfig.discussionSummary.windowMs / 60000
        )} minutes. Please wait ${Math.ceil(retryAfter / 60)} minutes and try again.`,
        429,
        { retryAfter }
      )
    );
  }

  try {
    const cacheKey = CacheKeys.discussion(id);
    const cached = discussionCache.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        ...cached,
        cached: true,
        cacheAge: Math.round((Date.now() - cached.generatedAt) / 1000),
      });
    }

    const model = "deepseek-ai/DeepSeek-V3.1";

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const topicResponse = await fetch(`${DISCOURSE_URL}/t/${id}.json`, {
      headers,
    });

    if (!topicResponse.ok) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "Discussion not found",
          topicResponse.status,
          { status: topicResponse.status }
        )
      );
    }

    const topicData: DiscourseTopic = await topicResponse.json();

    const posts = topicData.post_stream?.posts || [];
    const originalPost: DiscoursePost | undefined = posts[0];
    const replies: DiscoursePost[] = posts.slice(1);

    if (!originalPost) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "Original post not found",
          404
        )
      );
    }

    if (replies.length === 0) {
      const emptyResponse: DiscussionSummaryResponse = {
        success: true,
        summary:
          "No replies yet. The community hasn't responded to this proposal.",
        topicId: id,
        title: topicData.title,
        replyCount: 0,
        truncated: false,
        engagement: {
          totalLikes: 0,
          totalReplies: 0,
          participantCount: topicData.participant_count,
          avgLikesPerReply: 0,
          highlyEngagedReplies: 0,
          maxLikes: 0,
        },
        generatedAt: Date.now(),
        cached: false,
        model,
        verificationResult: {
          verified: false,
          reasons: ["No replies to summarize"],
          status: "failed",
          warnings: [],
        },
      };
      return res.status(200).json(emptyResponse);
    }

    const stripHtml = (html: string): string => {
      return html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const repliesWithEngagement: ReplyWithEngagement[] = replies.map(
      (post: DiscoursePost) => ({
        ...post,
        likeCount:
          post.actions_summary?.find((a: DiscourseActionSummary) => a.id === 2)
            ?.count || 0,
      })
    );

    const totalLikes = repliesWithEngagement.reduce(
      (sum: number, r: ReplyWithEngagement) => sum + r.likeCount,
      0
    );
    const avgLikes =
      replies.length > 0
        ? parseFloat((totalLikes / replies.length).toFixed(1))
        : 0;
    const maxLikes = Math.max(
      ...repliesWithEngagement.map((r) => r.likeCount),
      0
    );
    const highlyEngagedReplies = repliesWithEngagement.filter(
      (r) => r.likeCount > 5
    ).length;

    const originalContent = stripHtml(originalPost.cooked);
    const MAX_ORIGINAL_LENGTH = 2000;
    const truncatedOriginal =
      originalContent.length > MAX_ORIGINAL_LENGTH
        ? originalContent.substring(0, MAX_ORIGINAL_LENGTH) +
          "\n\n[... original post truncated for brevity ...]"
        : originalContent;

    const originalPostContext = `**ORIGINAL PROPOSAL (Post #1) by @${originalPost.username}:**

${truncatedOriginal}

---

**COMMUNITY REPLIES:**

`;

    const repliesText = repliesWithEngagement
      .slice(0, 100)
      .map((post: ReplyWithEngagement, index: number) => {
        const cleanContent = stripHtml(post.cooked);
        const engagementNote =
          post.likeCount > 0 ? ` [${post.likeCount} likes]` : "";
        const replyToNote = post.reply_to_post_number
          ? ` [Replying to Post #${post.reply_to_post_number}${
              post.reply_to_user ? ` by @${post.reply_to_user.username}` : ""
            }]`
          : "";

        return `**Reply ${index + 1}** (Post #${post.post_number}) by @${
          post.username
        }${engagementNote}${replyToNote}:\n${cleanContent}`;
      })
      .join("\n\n---\n\n");

    const fullDiscussion = originalPostContext + repliesText;
    const MAX_LENGTH = 14000;
    const truncatedDiscussion =
      fullDiscussion.length > MAX_LENGTH
        ? fullDiscussion.substring(0, MAX_LENGTH) +
          "\n\n[... additional replies truncated ...]"
        : fullDiscussion;

    const client = getNearAIClient();
    const verificationId = createSummaryVerificationId();
    const prompt = buildDiscussionSummaryPrompt(
      { title: topicData.title },
      replies,
      totalLikes,
      avgLikes,
      maxLikes,
      highlyEngagedReplies,
      truncatedDiscussion
    );

    const { summary, verification: verificationData } = await runSummaryFlow({
      client,
      origin,
      verificationId,
      model,
      userPrompt: prompt,
      temperature: 0.4,
      maxTokens: 1000,
    });

    if (!summary) {
      throw new Error("Empty summary returned from AI");
    }

    const response: DiscussionSummaryResponse = {
      success: true,
      summary,
      topicId: id,
      title: topicData.title,
      replyCount: replies.length,
      truncated: fullDiscussion.length > MAX_LENGTH,
      engagement: {
        totalLikes,
        totalReplies: replies.length,
        participantCount: topicData.participant_count,
        avgLikesPerReply: avgLikes,
        highlyEngagedReplies,
        maxLikes,
      },
      generatedAt: Date.now(),
      cached: false,
      model,
      verification: verificationData.verificationMetadata,
      verificationResult: verificationData.verificationResult,
      verificationId,
      proof: verificationData.proof,
    };

    discussionCache.set(cacheKey, response);
    return res.status(200).json(response);
  } catch (error: unknown) {
    logger.error("[Discussion Summary] Error:", error);
    const details =
      error instanceof Error && process.env.NODE_ENV === "development"
        ? error.message
        : undefined;
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to generate discussion summary",
        500,
        details
      )
    );
  }
}
