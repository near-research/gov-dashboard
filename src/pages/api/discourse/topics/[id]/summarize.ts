import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
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
import type {
  DiscussionSummaryResponse,
  SummaryProof,
} from "@/types/summaries";
import {
  extractVerificationMetadata,
  normalizeVerificationPayload,
} from "@/utils/verification";
import {
  registerVerificationSession,
  updateVerificationHashes,
} from "@/server/verificationSessions";
import { getModelExpectations } from "@/server/attestation-cache";
import { prefetchVerificationProof } from "@/server/prefetchVerificationProof";
import { mergeVerificationStatusFromProof } from "@/server/verificationUtils";
import { getNearAIClient } from "@/lib/near-ai/client";

const ensureVerificationSession = (
  verificationId?: string | null,
  proof?: SummaryProof | null
) => {
  if (!verificationId || !proof) return;
  try {
    registerVerificationSession(
      verificationId,
      proof.nonce || undefined,
      proof.requestHash || null,
      proof.responseHash || null
    );
  } catch (err) {
    console.error(
      "[discussion summary] Failed to ensure verification session:",
      err
    );
  }
};

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
      ensureVerificationSession(cached.verificationId, cached.proof || null);
      const verification = mergeVerificationStatusFromProof(
        cached.verification,
        cached.remoteProof
      );
      return res.status(200).json({
        ...cached,
        verification,
        cached: true,
        cacheAge: Math.round((Date.now() - cached.generatedAt) / 1000), // Age in seconds
      });
    }

    const model = "deepseek-ai/DeepSeek-V3.1";

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
        model,
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
          post.actions_summary?.find((a: DiscourseActionSummary) => a.id === 2)
            ?.count || 0,
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
    const client = getNearAIClient();

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

    const nearRequest = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 1000,
    };
    const requestBody = JSON.stringify(nearRequest);
    const requestHash = createHash("sha256").update(requestBody).digest("hex");
    const generatedVerificationId = `summary-${randomBytes(8).toString("hex")}`;
    const session = registerVerificationSession(
      generatedVerificationId,
      undefined,
      requestHash,
      null
    );
    let expectations: Awaited<ReturnType<typeof getModelExpectations>> | null =
      null;
    try {
      expectations = await getModelExpectations(model);
    } catch (err) {
      console.error(
        "[Discussion Summary] Failed to fetch hardware expectations:",
        err
      );
    }

    const data = await client.chatCompletions(nearRequest, {
      verificationId: generatedVerificationId,
      verificationNonce: session.nonce,
    });

    const responseText = JSON.stringify(data);
    const responseHash = createHash("sha256")
      .update(responseText)
      .digest("hex");
    const summary: string = data.choices[0]?.message?.content ?? "";
    const rawVerification = extractVerificationMetadata(data);
    const nearMessageId =
      data?.id || generatedVerificationId;
    const { verification, verificationId: normalizedVerificationId } =
      normalizeVerificationPayload(rawVerification, nearMessageId);
    const effectiveVerificationId =
      normalizedVerificationId || generatedVerificationId;

    updateVerificationHashes(generatedVerificationId, {
      requestHash,
      responseHash,
    });

    if (effectiveVerificationId !== generatedVerificationId) {
      registerVerificationSession(
        effectiveVerificationId,
        session.nonce,
        requestHash,
        responseHash
      );
    }

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
      model,
      verification,
      verificationId: effectiveVerificationId,
      proof: {
        requestHash,
        responseHash,
        nonce: session.nonce,
        arch: expectations?.arch,
        deviceCertHash: expectations?.deviceCertHash,
        rimHash: expectations?.rimHash,
        ueid: expectations?.ueid,
        measurements: expectations?.measurements,
      },
    };

    const remoteProof = await prefetchVerificationProof(origin, {
      verificationId: effectiveVerificationId,
      model,
      requestHash,
      responseHash,
      nonce: session.nonce,
      expectedArch: expectations?.arch ?? null,
      expectedDeviceCertHash: expectations?.deviceCertHash ?? null,
      expectedRimHash: expectations?.rimHash ?? null,
      expectedUeid: expectations?.ueid ?? null,
      expectedMeasurements: expectations?.measurements ?? null,
    });
    if (remoteProof) {
      response.remoteProof = remoteProof;
      response.verification =
        mergeVerificationStatusFromProof(response.verification, remoteProof) ??
        response.verification;
    }

    // ===================================================================
    // STORE IN CACHE (5 minute TTL for active discussions)
    // ===================================================================
    discussionCache.set(cacheKey, response);

    ensureVerificationSession(response.verificationId, response.proof);
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
