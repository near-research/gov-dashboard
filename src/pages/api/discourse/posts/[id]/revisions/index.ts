import type { NextApiRequest, NextApiResponse } from "next";
import { servicesConfig } from "@/config/services";

/**
 * GET /api/discourse/topics/[id]/revisions
 *
 * Fetches all revisions for a topic's first post (the proposal).
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
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid proposal ID" });
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
      return res.status(topicResponse.status).json({
        error: "Failed to fetch topic",
        status: topicResponse.status,
      });
    }

    const topicData = await topicResponse.json();
    const firstPost = topicData.post_stream?.posts?.[0];

    if (!firstPost) {
      return res.status(404).json({ error: "Post not found" });
    }

    const postId = firstPost.id;
    const version = firstPost.version || 1;

    console.log(`[Revisions] Post ${postId} is at version ${version}`);

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

          console.log(`[Revisions] Fetched revision ${i}/${version}`);
        } else {
          console.warn(
            `[Revisions] Failed to fetch revision ${i}: ${revResponse.status}`
          );
        }
      } catch (err) {
        console.error(`[Revisions] Error fetching revision ${i}:`, err);
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
    console.error("[Revisions] Error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch revisions";
    return res.status(500).json({
      error: "Failed to fetch revisions",
      message,
    });
  }
}
