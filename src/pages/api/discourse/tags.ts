import type { NextApiRequest, NextApiResponse } from "next";
import { logger } from "@/lib/logger";
import { discourseTags } from "@/server/plugins/discourse-client";
import { ErrorCodes } from "@/lib/api/errors";
import type { ApiErrorResponse } from "@/types/api";
import type { TagsResponse } from "@/types/api/discourse";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TagsResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Only GET requests are allowed",
      code: ErrorCodes.METHOD_NOT_ALLOWED,
    });
  }

  try {
    const { data, error, status } = await discourseTags();
    if (error || !data) {
      const upstreamStatus = status ?? 502;
      const statusCode = upstreamStatus >= 500 ? 502 : upstreamStatus;
      const payload: ApiErrorResponse = {
        error: error ?? "Failed to fetch tags",
        code: ErrorCodes.UPSTREAM_ERROR,
      };
      return res.status(statusCode).json(payload);
    }

    return res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[discourse/tags] Request failed", {
      error: message,
      query: req.query,
    });
    const payload: ApiErrorResponse = {
      error: "Discourse request failed",
      code: ErrorCodes.INTERNAL_ERROR,
      details: message,
    };
    return res.status(500).json(payload);
  }
}
