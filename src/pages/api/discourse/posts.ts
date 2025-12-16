import type { NextApiRequest, NextApiResponse } from "next";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { discoursePost } from "@/server/plugins/discourse-client";

const parseId = (value: string | string[] | undefined): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseBoolean = (value: string | string[] | undefined): boolean | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>
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
        "Post id is required. Use /api/discourse/posts/:id.",
        400
      );
    }

    const includeRaw = parseBoolean(req.query.include_raw) ?? undefined;
    if (req.query.include_raw !== undefined && includeRaw === null) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid `include_raw` parameter",
        400
      );
    }

    const { data, error, status } = await discoursePost({
      postId,
      includeRaw,
    });

    if (error || !data) {
      const upstreamStatus = status ?? 502;
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        error ?? "Failed to fetch post",
        upstreamStatus >= 500 ? 502 : upstreamStatus
      );
    }

    return res.status(200).json(data);
  } catch (error) {
    logger.error("[discourse/posts] Request failed", {
      error: error instanceof Error ? error.message : String(error),
      query: req.query,
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
