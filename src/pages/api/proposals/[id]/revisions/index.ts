import type { NextApiRequest, NextApiResponse } from "next";
import { servicesConfig } from "@/config/services";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

/**
 * GET /api/proposals/[id]/revisions
 *
 * Fetches all revisions for a proposal (topic's first post).
 * Public endpoint - no authentication required.
 *
 * Returns:
 * - post_id: The ID of the first post
 * - revisions: Array of all revisions with changes
 * - total_revisions: Count of revisions
 * - current_version: Latest version number
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
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
      new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid topic ID", 400)
    );
  }

  try {
    const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Get the topic to find the first post
    const topicResponse = await fetch(`${DISCOURSE_URL}/t/${id}.json`, {
      headers,
    });

    if (!topicResponse.ok) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.UPSTREAM_ERROR,
          "Failed to fetch topic",
          topicResponse.status,
          { status: topicResponse.status }
        )
      );
    }

    const topicData = await topicResponse.json();
    const firstPost = topicData.post_stream?.posts?.[0];

    if (!firstPost) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "Post not found in topic",
          404
        )
      );
    }

    const postId = firstPost.id;
    const version = firstPost.version || 1;

    logger.debug(
      `[Proposal Revisions] Topic ${id} -> Post ${postId} version ${version}`
    );

    // If version is 1, no edits have been made
    if (version <= 1) {
      return res.status(200).json({
        post_id: postId,
        revisions: [],
        total_revisions: 0,
        current_version: version,
      });
    }

    // Fetch all revisions (they always start at version 2)
    const revisions = [];
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

          logger.debug(`[Proposal Revisions] Fetched revision ${i}/${version}`);
        } else {
          logger.warn(
            `[Proposal Revisions] Failed to fetch revision ${i}: ${revResponse.status}`
          );
        }
      } catch (err) {
        logger.error(
          `[Proposal Revisions] Error fetching revision ${i}:`,
          err
        );
        // Continue fetching other revisions
      }
    }

    return res.status(200).json({
      post_id: postId,
      revisions,
      total_revisions: revisions.length,
      current_version: version,
    });
  } catch (error: unknown) {
    logger.error("[Proposal Revisions] Error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch revisions";
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to fetch revisions",
        500,
        { message }
      )
    );
  }
}
