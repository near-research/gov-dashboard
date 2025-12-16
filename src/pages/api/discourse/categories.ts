import type { NextApiRequest, NextApiResponse } from "next";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { discourseCategories } from "@/server/plugins/discourse-client";

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
    const { data, error, status } = await discourseCategories();
    if (error || !data) {
      const upstreamStatus = status ?? 502;
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        error ?? "Failed to fetch categories",
        upstreamStatus >= 500 ? 502 : upstreamStatus
      );
    }

    return res.status(200).json(data);
  } catch (error) {
    logger.error("[discourse/categories] Request failed", {
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
