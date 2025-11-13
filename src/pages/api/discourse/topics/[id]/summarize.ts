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
import type { DiscussionSummaryResponse } from "@/types/summaries";

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
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid topic ID" });
  }

  const clientId = getClientIdentifier(req);
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
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: `You've reached the limit of ${
        rateLimitConfig.discussionSummary.maxRequests
      } discussion summaries in ${Math.round(
        rateLimitConfig.discussionSummary.windowMs / 60000
      )} minutes. Please wait ${Math.ceil(
        retryAfter / 60
      )} minutes and try again.`,
      retryAfter,
    });
  }

  try {
    // ===================================================================
    // CACHE CHECK
    // ===================================================================
    const cacheKey = CacheKeys.discussion(id);
    const cached = discussionCache.get(cacheKey);

    if (cached) {
      // Return cached result
      return res.status(200).json({
        ...cached,
        cached: true,
        cacheAge: Math.round((Date.now() - cached.generatedAt) / 1000), // Age in seconds
      });
    }

    // ===================================================================
    // FETCH FROM DISCOURSE (NO AUTH)
    // ===================================================================
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const topicResponse = await fetch(`${DISCOURSE_URL}/t/${id}.json`, {
      headers,
    });

    if (!topicResponse.ok) {
      return res.status(404).json({ error: "Discussion not found" });
    }

    const topicData: DiscourseTopic = await topicResponse.json();

    // Get all posts - KEEP THE FIRST ONE (original proposal)
    const posts = topicData.post_stream?.posts || [];
    const originalPost: DiscoursePost | undefined = posts[0];
    const replies: DiscoursePost[] = posts.slice(1); // Get replies separately

    if (!originalPost) {
      return res.status(404).json({ error: "Original post not found" });
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
      };
      return res.status(200).json(emptyResponse);
    }

    // Strip HTML
    const stripHtml = (html: string): string => {
      return html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    // Add engagement data (like counts) to each reply
    const repliesWithEngagement: ReplyWithEngagement[] = replies.map(
      (post: DiscoursePost) => ({
        ...post,
        likeCount:
          post.actions_summary?.find(
            (a: DiscourseActionSummary) => a.id === 2
          )?.count ||
          0,
      })
    );

    // Calculate engagement statistics for context
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

    // ===================================================================
    // BUILD DISCUSSION WITH ORIGINAL POST CONTEXT
    // ===================================================================
    const originalContent = stripHtml(originalPost.cooked);

    // Truncate original post if very long (keep first 2000 chars)
    const MAX_ORIGINAL_LENGTH = 2000;
    const truncatedOriginal =
      originalContent.length > MAX_ORIGINAL_LENGTH
        ? originalContent.substring(0, MAX_ORIGINAL_LENGTH) +
          "\n\n[... original post truncated for brevity ...]"
        : originalContent;

    // Build the original post context
    const originalPostContext = `**ORIGINAL PROPOSAL (Post #1) by @${originalPost.username}:**

${truncatedOriginal}

---

**COMMUNITY REPLIES:**

`;

    // Build discussion text in CHRONOLOGICAL order with engagement and threading info
    const repliesText = repliesWithEngagement
      .slice(0, 100) // Take first 100 replies (chronological)
      .map((post: ReplyWithEngagement, index: number) => {
        const cleanContent = stripHtml(post.cooked);

        // Show like counts to help AI understand relative engagement
        const engagementNote =
          post.likeCount > 0 ? ` [${post.likeCount} likes]` : "";

        // CRITICAL: Show which post this is replying to for conversation threading
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

    // Combine original post + replies
    const fullDiscussion = originalPostContext + repliesText;

    // Truncate if needed (now accounting for original post length)
    const MAX_LENGTH = 14000; // Increased slightly to account for original post
    const truncatedDiscussion =
      fullDiscussion.length > MAX_LENGTH
        ? fullDiscussion.substring(0, MAX_LENGTH) +
          "\n\n[... additional replies truncated ...]"
        : fullDiscussion;

    // ===================================================================
    // GENERATE AI SUMMARY USING PROMPT BUILDER
    // ===================================================================
    const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI API not configured" });
    }

    // Use the prompt builder function
    const prompt = buildDiscussionSummaryPrompt(
      { title: topicData.title },
      replies,
      totalLikes,
      avgLikes,
      maxLikes,
      highlyEngagedReplies,
      truncatedDiscussion
    );

    const summaryResponse = await fetch(
      "https://cloud-api.near.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-ai/DeepSeek-V3.1",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
          max_tokens: 1000,
        }),
      }
    );

    if (!summaryResponse.ok) {
      throw new Error(`AI summary failed: ${summaryResponse.status}`);
    }

    const data = await summaryResponse.json();
    const summary: string = data.choices[0]?.message?.content ?? "";

    if (!summary) {
      throw new Error("Empty summary returned from AI");
    }

    // ===================================================================
    // BUILD RESPONSE
    // ===================================================================
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
      generatedAt: Date.now(), // For cache age tracking
      cached: false,
    };

    // ===================================================================
    // STORE IN CACHE (5 minute TTL for active discussions)
    // ===================================================================
    discussionCache.set(cacheKey, response);

    return res.status(200).json(response);
  } catch (error: unknown) {
    console.error("[Discussion Summary] Error:", error);
    const details =
      error instanceof Error && process.env.NODE_ENV === "development"
        ? error.message
        : undefined;
    return res.status(500).json({
      error: "Failed to generate discussion summary",
      details,
    });
  }
}
