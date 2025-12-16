import type { NextApiRequest, NextApiResponse } from "next";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { discourseCategory } from "@/server/plugins/discourse-client";

const parseIdOrSlug = (
  value: string | string[] | undefined
): string | number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const numeric = Number.parseInt(value, 10);
  if (!Number.isNaN(numeric) && numeric > 0) return numeric;
  if (value.trim().length === 0) return null;
  return value;
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
    const idOrSlug = parseIdOrSlug(req.query.id);
    if (idOrSlug === null) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid category id or slug",
        400
      );
    }

    const { data, error, status } = await discourseCategory({ idOrSlug });
    if (error || !data) {
      const upstreamStatus = status ?? 502;
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        error ?? "Failed to fetch category",
        upstreamStatus >= 500 ? 502 : upstreamStatus
      );
    }

    return res.status(200).json(data);
  } catch (error) {
    logger.error("[discourse/categories/id] Request failed", {
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
