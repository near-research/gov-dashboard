import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
import { proposalCache, CacheKeys } from "@/utils/cache-utils";
import { buildProposalSummaryPrompt } from "@/lib/prompts/summarizeProposal";
import { stripFrontmatter } from "@/utils/metadata";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { servicesConfig } from "@/config/services";
import type { ApiErrorResponse } from "@/types/api";
import type { ProposalSummaryResponse, SummaryProof } from "@/types/summaries";
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
    console.error("[proposal summary] Failed to ensure verification session:", err);
  }
};

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
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid proposal ID" });
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
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: `You've reached the limit of ${
        rateLimitConfig.proposalSummary.maxRequests
      } proposal summaries in ${Math.round(
        rateLimitConfig.proposalSummary.windowMs / 60000
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
    const cacheKey = CacheKeys.proposal(id);
    const cached = proposalCache.get(cacheKey);

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

    const topicResponse = await fetch(`${DISCOURSE_URL}/t/${id}.json`, {
      headers,
    });

    if (!topicResponse.ok) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    const topicData = await topicResponse.json();

    // Get the first post (the proposal)
    const proposalPost = topicData.post_stream?.posts?.[0];
    if (!proposalPost) {
      return res.status(404).json({ error: "Proposal post not found" });
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
    console.warn(`[Proposal Summary] Could not fetch raw content:`, err);
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

    // Use the prompt builder function
    const prompt = buildProposalSummaryPrompt(
      { title: topicData.title, category_id: topicData.category_id },
      { username: proposalPost.username },
      truncatedContent
    );

    const model = NEAR_AI_MODELS.DEEPSEEK_V3_1;
    const nearRequest = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 800,
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
      console.error("[Proposal Summary] Failed to fetch hardware expectations:", err);
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
    // STORE IN CACHE (1 hour TTL)
    // ===================================================================
    proposalCache.set(cacheKey, response);

    ensureVerificationSession(response.verificationId, response.proof);
    return res.status(200).json(response);
  } catch (error: unknown) {
    console.error("[Proposal Summary] Error:", error);
    const details =
      error instanceof Error && process.env.NODE_ENV === "development"
        ? error.message
        : undefined;
    return res.status(500).json({
      error: "Failed to generate proposal summary",
      details,
    });
  }
}
