import type { NextApiRequest, NextApiResponse } from "next";
import { proposalCache, CacheKeys } from "@/utils/cache-utils";
import { buildProposalSummaryPrompt } from "@/lib/prompts/summarizeProposal";
import { stripFrontmatter } from "@/utils/metadata";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { servicesConfig } from "@/config/services";
import type { ApiErrorResponse } from "@/types/api";
import type { ProposalSummaryResponse } from "@/components/proposal/types/summaries";
import { getNearAIClient } from "@/lib/near-ai";
import { NEAR_AI_MODELS } from "@/utils/model-utils";
import { runSummaryFlow } from "@/lib/near-ai/summarize";
import { createSummaryVerificationId } from "@/server/summaryVerification";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

const proposalSummarizeLimiter = createRateLimiter(
  rateLimitConfig.proposalSummary
);
const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

/**
 * POST /api/proposals/[id]/summarize
 *
 * Generates an AI summary of a PROPOSAL (the first post in a topic).
 * Executive-style summary focusing on key points and decision factors.
 *
 * CACHING: 1 hour TTL (proposals rarely change)
 *
 * Security:
 * - Public endpoint (no auth required)
 * - Rate limited to prevent abuse
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProposalSummaryResponse | ApiErrorResponse>
) {
  if (req.method !== "POST") {
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.METHOD_NOT_ALLOWED,
        "Method not allowed",
        405
      )
    );
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid proposal ID", 400)
    );
  }

  const clientId = getClientIdentifier(req);
  const origin =
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : undefined);
  const { allowed, remaining, resetTime } =
    proposalSummarizeLimiter.check(clientId);
  const secondsUntilReset = Math.max(
    0,
    Math.ceil((resetTime - Date.now()) / 1000)
  );

  res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0).toString());
  res.setHeader("X-RateLimit-Limit", proposalSummarizeLimiter.limit.toString());
  res.setHeader("X-RateLimit-Reset", secondsUntilReset.toString());

  if (!allowed) {
    const retryAfter =
      secondsUntilReset || rateLimitConfig.proposalSummary.windowMs / 1000;
    res.setHeader("Retry-After", retryAfter.toString());
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.RATE_LIMITED,
        `You've reached the limit of ${
          rateLimitConfig.proposalSummary.maxRequests
        } proposal summaries in ${Math.round(
          rateLimitConfig.proposalSummary.windowMs / 60000
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
    const cacheKey = CacheKeys.proposal(id);
    const cached = proposalCache.get(cacheKey);

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

    const topicResponse = await fetch(`${DISCOURSE_URL}/t/${id}.json`, {
      headers,
    });

    if (!topicResponse.ok) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "Proposal not found",
          404,
          { upstreamStatus: topicResponse.status }
        )
      );
    }

    const topicData = await topicResponse.json();

    // Get the first post (the proposal)
    const proposalPost = topicData.post_stream?.posts?.[0];
    if (!proposalPost) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "Proposal post not found",
          404
        )
      );
    }

    // Fetch raw markdown content
    let rawContent = "";
    try {
      const rawResponse = await fetch(`${DISCOURSE_URL}/raw/${id}`, {
        headers: { Accept: "text/plain" },
      });
      if (rawResponse.ok) {
        const fullRaw = await rawResponse.text();
        // Remove the header line (username | date | #1)
        rawContent = fullRaw.replace(
          /^[\w\-_]+ \| \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC \| #\d+\n\n/,
          ""
        );
      }
    } catch (err) {
      logger.warn(`[Proposal Summary] Could not fetch raw content:`, err);
    }

    // Use raw if available, fallback to cooked
    const content = rawContent || proposalPost.cooked;

    // Strip frontmatter for cleaner summary
    const contentWithoutFrontmatter = stripFrontmatter(content);

    // Truncate if needed
    const MAX_LENGTH = 8000;
    const truncatedContent =
      contentWithoutFrontmatter.length > MAX_LENGTH
        ? contentWithoutFrontmatter.substring(0, MAX_LENGTH) +
          "\n\n[... content truncated for length ...]"
        : contentWithoutFrontmatter;

    // ===================================================================
    // GENERATE AI SUMMARY USING PROMPT BUILDER
    // ===================================================================
    const client = getNearAIClient();
    const verificationId = createSummaryVerificationId();

    // Use the prompt builder function
    const prompt = buildProposalSummaryPrompt(
      { title: topicData.title, category_id: topicData.category_id },
      { username: proposalPost.username },
      truncatedContent
    );

    const model = NEAR_AI_MODELS.DEEPSEEK_V3_1;
    const { summary, verification: verificationData } = await runSummaryFlow({
      client,
      origin,
      verificationId,
      model,
      userPrompt: prompt,
      temperature: 0.5,
      maxTokens: 800,
    });

    if (!summary) {
      throw new Error("Empty summary returned from AI");
    }

    // ===================================================================
    // BUILD RESPONSE
    // ===================================================================
    const response: ProposalSummaryResponse = {
      success: true,
      summary,
      proposalId: id,
      title: topicData.title,
      author: proposalPost.username,
      createdAt: proposalPost.created_at,
      truncated: contentWithoutFrontmatter.length > MAX_LENGTH,
      viewCount: topicData.views,
      replyCount: topicData.posts_count ? topicData.posts_count - 1 : 0, // Subtract the proposal itself
      likeCount: proposalPost.like_count || 0,
      generatedAt: Date.now(), // For cache age tracking
      cached: false,
      model,
      verification: verificationData.verificationMetadata,
      verificationResult: verificationData.verificationResult,
      verificationId,
      proof: verificationData.proof,
    };

    proposalCache.set(cacheKey, response);
    return res.status(200).json(response);
  } catch (error: unknown) {
    logger.error("[Proposal Summary] Error:", error);
    const details =
      error instanceof Error && process.env.NODE_ENV === "development"
        ? error.message
        : undefined;
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to generate proposal summary",
        500,
        details
      )
    );
  }
}
