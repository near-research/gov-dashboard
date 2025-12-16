import type { NextApiRequest, NextApiResponse } from "next";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { DISCOURSE_RENDER_LIMIT } from "@/config/discourse";
import { discourseReplies } from "@/server/plugins/discourse-client";
import type { PaginatedPosts } from "@/server/plugins/discourse-schemas";

const parseId = (value: string | string[] | undefined): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PaginatedPosts | { error: string }>
) {
  if (req.method !== "GET") {
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.METHOD_NOT_ALLOWED,
        "Only GET requests are allowed",
        405
      )
    );
  }

  try {
    const postId = parseId(req.query.id);
    if (!postId) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid post id",
        400
      );
    }

    const { data, error, status } = await discourseReplies({ postId });

    if (error || !data) {
      const upstreamStatus = status ?? 502;
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        error ?? "Failed to fetch replies",
        upstreamStatus >= 500 ? 502 : upstreamStatus
      );
    }

    const responseData: PaginatedPosts = { ...data };
    if (Array.isArray(responseData.posts)) {
      responseData.posts = responseData.posts.slice(0, DISCOURSE_RENDER_LIMIT);
    }

    return res.status(200).json(responseData);
  } catch (error) {
    logger.error("[discourse/posts/replies] Request failed", {
      error: error instanceof Error ? error.message : String(error),
      params: req.query,
    });

    if (error instanceof ApiError || error instanceof Error) {
      return respondWithError(res, error);
    }

    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Discourse request failed",
        500
      )
    );
  }
}
