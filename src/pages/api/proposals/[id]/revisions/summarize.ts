import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
import { revisionCache, CacheKeys } from "@/utils/cache-utils";
import { buildRevisionAnalysisPrompt } from "@/lib/prompts/summarizeRevisions";
import { stripHtml } from "@/utils/html-utils";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { servicesConfig } from "@/config/services";
import type {
  DiscourseRevision,
  RevisionBodyChange,
  RevisionTitleChange,
} from "@/types/discourse";
import type { ApiErrorResponse } from "@/types/api";
import type {
  ProposalRevisionSummaryResponse,
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
      "[proposal revision summary] Failed to ensure verification session:",
      err
    );
  }
};

const proposalRevisionLimiter = createRateLimiter(
  rateLimitConfig.proposalRevisions
);
const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

/**
 * POST /api/proposals/[id]/revisions/summarize
 *
 * Generates an AI summary of ALL REVISIONS to a proposal (topic's first post).
 * Analyzes what changed, why, and the significance of edits.
 *
 * CACHING: 15 minute TTL
 *
 * Security:
 * - Public endpoint (no auth required)
 * - Rate limited to prevent abuse
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProposalRevisionSummaryResponse | ApiErrorResponse>
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
  const { allowed, remaining, resetTime } =
    proposalRevisionLimiter.check(clientId);
  const secondsUntilReset = Math.max(
    0,
    Math.ceil((resetTime - Date.now()) / 1000)
  );

  res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0).toString());
  res.setHeader("X-RateLimit-Limit", proposalRevisionLimiter.limit.toString());
  res.setHeader("X-RateLimit-Reset", secondsUntilReset.toString());

  if (!allowed) {
    const retryAfter =
      secondsUntilReset || rateLimitConfig.proposalRevisions.windowMs / 1000;
    res.setHeader("Retry-After", retryAfter.toString());
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: `You've reached the limit of ${
        rateLimitConfig.proposalRevisions.maxRequests
      } revision summaries in ${Math.round(
        rateLimitConfig.proposalRevisions.windowMs / 60000
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
    const cacheKey = CacheKeys.proposalRevision(id);
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

    const model = "deepseek-ai/DeepSeek-V3.1";

    // ===================================================================
    // FETCH FROM DISCOURSE (NO AUTH)
    // ===================================================================
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Get topic to find first post
    const topicResponse = await fetch(`${DISCOURSE_URL}/t/${id}.json`, {
      headers,
    });

    if (!topicResponse.ok) {
      return res.status(404).json({
        error: "Topic not found",
        status: topicResponse.status,
      });
    }

    const topicData = await topicResponse.json();
    const firstPost = topicData.post_stream?.posts?.[0];

    if (!firstPost) {
      return res.status(404).json({ error: "Post not found in topic" });
    }

    const postId = firstPost.id;
    const version = firstPost.version || 1;

    console.log(
      `[Proposal Revisions] Topic ${id} -> Post ${postId} version ${version}`
    );

    // If version is 1, no edits have been made
    if (version <= 1) {
      const emptySummary: ProposalRevisionSummaryResponse = {
        success: true,
        summary: "This post has not been edited. No revisions to analyze.",
        topicId: id,
        postId: postId,
        author: firstPost.username,
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
        const revUrl = `${DISCOURSE_URL}/posts/${postId}/revisions/${i}.json`;
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

          console.log(`[Proposal Revisions] Fetched revision ${i}/${version}`);
        } else {
          console.warn(
            `[Proposal Revisions] Failed to fetch revision ${i}: ${revResponse.status}`
          );
        }
      } catch (err) {
        console.error(
          `[Proposal Revisions] Error fetching revision ${i}:`,
          err
        );
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
          // Try to use side-by-side markdown first (clearer before/after)
          if (rev.body_changes.side_by_side_markdown) {
            const cleanDiff = stripHtml(rev.body_changes.side_by_side_markdown);
            const truncatedDiff =
              cleanDiff.length > 1500
                ? cleanDiff.substring(0, 1500) + "\n[... diff truncated ...]"
                : cleanDiff;
            parts.push(
              `- **Content Changes (Before/After):**\n${truncatedDiff}`
            );
          } else if (rev.body_changes.side_by_side) {
            const cleanDiff = stripHtml(rev.body_changes.side_by_side);
            const truncatedDiff =
              cleanDiff.length > 1500
                ? cleanDiff.substring(0, 1500) + "\n[... diff truncated ...]"
                : cleanDiff;
            parts.push(
              `- **Content Changes (Before/After):**\n${truncatedDiff}`
            );
          } else {
            // Fallback to inline diff
            const cleanDiff = stripHtml(rev.body_changes.inline);
            const truncatedDiff =
              cleanDiff.length > 1000
                ? cleanDiff.substring(0, 1000) + "\n[... diff truncated ...]"
                : cleanDiff;
            parts.push(`- **Content Changes:**\n${truncatedDiff}`);
          }
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

    // Use the prompt builder function
    const prompt = buildRevisionAnalysisPrompt(
      postId.toString(),
      { username: firstPost.username },
      revisions,
      version,
      truncatedTimeline
    );

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
      console.error(
        "[Proposal Revision Summary] Failed to fetch hardware expectations:",
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
    const response: ProposalRevisionSummaryResponse = {
      success: true,
      summary,
      topicId: id,
      postId: postId,
      author: firstPost.username,
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
    console.error("[Proposal Revisions] Error:", error);
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
