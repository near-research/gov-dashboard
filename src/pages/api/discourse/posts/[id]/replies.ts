import type { NextApiRequest, NextApiResponse } from "next";
import { ErrorCodes } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { DISCOURSE_RENDER_LIMIT } from "@/config/discourse";
import { discourseReplies } from "@/server/plugins/discourse-client";
import type { ApiErrorResponse } from "@/types/api";
import type { RepliesResponse } from "@/types/api/discourse";

const parseId = (value: string | string[] | undefined): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RepliesResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Only GET requests are allowed",
      code: ErrorCodes.METHOD_NOT_ALLOWED,
    });
  }

  try {
    const postId = parseId(req.query.id);
    if (!postId) {
      return res.status(400).json({
        error: "Invalid post id",
        code: ErrorCodes.VALIDATION_ERROR,
      });
    }

    const { data, error, status } = await discourseReplies({ postId });

    if (error || !data) {
      const upstreamStatus = status ?? 502;
      const statusCode = upstreamStatus >= 500 ? 502 : upstreamStatus;
      const payload: ApiErrorResponse = {
        error: error ?? "Failed to fetch replies",
        code: ErrorCodes.UPSTREAM_ERROR,
      };
      return res.status(statusCode).json(payload);
    }

    const limitedPosts = Array.isArray(data.posts)
      ? data.posts.slice(0, DISCOURSE_RENDER_LIMIT)
      : [];

    return res.status(200).json({
      posts: limitedPosts,
      postId,
      total: Array.isArray(data.posts) ? data.posts.length : 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[discourse/posts/replies] Request failed", {
      error: message,
      params: req.query,
    });
    const payload: ApiErrorResponse = {
      error: "Discourse request failed",
      code: ErrorCodes.INTERNAL_ERROR,
      details: message,
    };
    return res.status(500).json(payload);
  }
}
