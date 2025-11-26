import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
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
import type { ReplySummaryResponse, SummaryProof } from "@/types/summaries";
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
import { NEAR_AI_MODELS } from "@/utils/model-utils";

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
      "[reply summary] Failed to ensure verification session:",
      err
    );
  }
};

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
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id: replyId } = req.query;

  if (!replyId || typeof replyId !== "string") {
    return res.status(400).json({ error: "Invalid reply ID" });
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
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: `You've reached the limit of ${
        rateLimitConfig.replySummary.maxRequests
      } reply summaries in ${Math.round(
        rateLimitConfig.replySummary.windowMs / 60000
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
    const cacheKey = CacheKeys.reply(replyId);
    const cached = replyCache.get(cacheKey);

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
      return res.status(404).json({
        error: "Reply not found",
        status: postResponse.status,
      });
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
        console.error(`[Reply Summary] Failed to fetch parent post:`, error);
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

    // Get like count for engagement context
    const likeCount =
      replyPost.actions_summary?.find(
        (a: DiscourseActionSummary) => a.id === 2
      )?.count || 0;

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
    const nearRequest = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3, // Very low for focused, brief output
      max_tokens: 250, // Short summaries only
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
      console.error("[Reply Summary] Failed to fetch hardware expectations:", err);
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
    // STORE IN CACHE (30 minute TTL)
    // ===================================================================
    replyCache.set(cacheKey, response);

    ensureVerificationSession(response.verificationId, response.proof);
    return res.status(200).json(response);
  } catch (error: unknown) {
    console.error("[Reply Summary] Error:", error);
    const details =
      error instanceof Error && process.env.NODE_ENV === "development"
        ? error.message
        : undefined;
    return res.status(500).json({
      error: "Failed to generate reply summary",
      details,
    });
  }
}
