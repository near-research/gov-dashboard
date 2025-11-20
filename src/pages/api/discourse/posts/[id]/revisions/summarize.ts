import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
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
import type {
  PostRevisionSummaryResponse,
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
      "[post revision summary] Failed to ensure verification session:",
      err
    );
  }
};

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
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid post ID" });
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
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: `You've reached the limit of ${
        rateLimitConfig.postRevisions.maxRequests
      } post revision summaries in ${Math.round(
        rateLimitConfig.postRevisions.windowMs / 60000
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
    const cacheKey = CacheKeys.postRevision(id);
    const cached = revisionCache.get(cacheKey);

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
        cacheAge: Math.round((Date.now() - cached.generatedAt) / 1000),
      });
    }

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
      return res.status(404).json({
        error: "Post not found",
        status: postResponse.status,
      });
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
        console.error(`Error fetching revision ${i}:`, err);
        // Continue fetching other revisions
      }
    }

    if (revisions.length === 0) {
      return res.status(404).json({
        error: "Could not fetch revision data",
      });
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
    const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI API not configured" });
    }

    // Use the prompt builder function
    const prompt = buildRevisionAnalysisPrompt(
      id,
      { username: postData.username },
      revisions,
      version,
      truncatedTimeline
    );

    const model = "deepseek-ai/DeepSeek-V3.1";
    const nearRequest = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
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
      console.error("[Post Revision Summary] Failed to fetch hardware expectations:", err);
    }

    const summaryResponse = await fetch(
      "https://cloud-api.near.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Verification-Id": generatedVerificationId,
          "X-Nonce": session.nonce,
        },
        body: requestBody,
      }
    );

    if (!summaryResponse.ok) {
      throw new Error(`AI summary failed: ${summaryResponse.status}`);
    }

    const responseText = await summaryResponse.text();
    const responseHash = createHash("sha256")
      .update(responseText)
      .digest("hex");
    const data = JSON.parse(responseText);
    const summary: string = data.choices[0]?.message?.content ?? "";
    const rawVerification = extractVerificationMetadata(data);
    const nearMessageId =
      data?.id || data?.choices?.[0]?.id || generatedVerificationId;
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
    // STORE IN CACHE (15 minute TTL)
    // ===================================================================
    revisionCache.set(cacheKey, response);

    ensureVerificationSession(response.verificationId, response.proof);
    return res.status(200).json(response);
  } catch (error: unknown) {
    console.error("Revision summary error:", error);
    const details =
      error instanceof Error && process.env.NODE_ENV === "development"
        ? error.message
        : undefined;
    return res.status(500).json({
      error: "Failed to generate revision summary",
      details,
    });
  }
}
