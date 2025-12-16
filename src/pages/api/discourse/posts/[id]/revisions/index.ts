import type { NextApiRequest, NextApiResponse } from "next";
import { servicesConfig } from "@/config/services";
import { ErrorCodes } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import type { ApiErrorResponse } from "@/types/api";
import type {
  RevisionsResponse,
  RevisionEntry,
} from "@/types/api/discourse";

const parseTopicId = (value: string | string[] | undefined): string | null => {
  if (!value || Array.isArray(value)) {
    return null;
  }
  return value.trim().length > 0 ? value : null;
};

const formatBodyChanges = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const candidateKeys = [
      "inline",
      "side_by_side",
      "side_by_side_markdown",
    ] as const;
    for (const key of candidateKeys) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
  }
  return undefined;
};

const buildRevisionSummary = (revision: Record<string, unknown>): RevisionEntry => ({
  version:
    typeof revision.current_version === "number"
      ? revision.current_version
      : typeof revision.version === "number"
      ? revision.version
      : 0,
  createdAt:
    typeof revision.created_at === "string"
      ? revision.created_at
      : "",
  username:
    typeof revision.username === "string"
      ? revision.username
      : "unknown",
  bodyChanges: formatBodyChanges(revision.body_changes),
});

const errorResponse = (
  message: string,
  code?: string,
  details?: unknown
): ApiErrorResponse => ({
  error: message,
  code,
  details,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RevisionsResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json(
      errorResponse("Method not allowed", ErrorCodes.METHOD_NOT_ALLOWED)
    );
  }

  const topicId = parseTopicId(req.query.id);
  if (!topicId) {
    return res.status(400).json(
      errorResponse("Invalid proposal ID", ErrorCodes.VALIDATION_ERROR)
    );
  }

  try {
    const DISCOURSE_URL = servicesConfig.discourseBaseUrl;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const topicResponse = await fetch(`${DISCOURSE_URL}/t/${topicId}.json`, {
      headers,
    });

    if (!topicResponse.ok) {
      return res.status(topicResponse.status).json(
        errorResponse(
          "Failed to fetch topic",
          ErrorCodes.UPSTREAM_ERROR,
          { status: topicResponse.status }
        )
      );
    }

    const topicData = await topicResponse.json();
    const firstPost = topicData.post_stream?.posts?.[0];

    if (!firstPost) {
      return res.status(404).json(
        errorResponse("Post not found", ErrorCodes.NOT_FOUND)
      );
    }

    const postId = firstPost.id;
    const version = firstPost.version ?? 1;

    logger.debug(`[Revisions] Post ${postId} is at version ${version}`);

    if (version <= 1) {
      const payload: RevisionsResponse = {
        postId,
        revisions: [],
      };
      return res.status(200).json(payload);
    }

    const revisions: RevisionEntry[] = [];

    for (let i = 2; i <= version; i++) {
      try {
        const revUrl = `${DISCOURSE_URL}/posts/${postId}/revisions/${i}.json`;
        const revResponse = await fetch(revUrl, { headers });

        if (revResponse.ok) {
          const revData = await revResponse.json();
          revisions.push(buildRevisionSummary(revData));
          logger.debug(`[Revisions] Fetched revision ${i}/${version}`);
        } else {
          logger.warn(
            `[Revisions] Failed to fetch revision ${i}: ${revResponse.status}`
          );
        }
      } catch (err) {
        logger.error(`[Revisions] Error fetching revision ${i}:`, err);
      }
    }

    const payload: RevisionsResponse = {
      postId,
      revisions,
    };

    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch revisions";
    logger.error("[Revisions] Error:", error);
    return res.status(500).json(
      errorResponse(
        "Failed to fetch revisions",
        ErrorCodes.INTERNAL_ERROR,
        { message }
      )
    );
  }
}
