import type { NextApiRequest, NextApiResponse } from "next";
import { ErrorCodes } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { discourseCategory } from "@/server/plugins/discourse-client";
import type { ApiErrorResponse } from "@/types/api";
import type { CategoryDetailResponse } from "@/types/api/discourse";

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
  res: NextApiResponse<CategoryDetailResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Only GET requests are allowed",
      code: ErrorCodes.METHOD_NOT_ALLOWED,
    });
  }

  try {
    const idOrSlug = parseIdOrSlug(req.query.id);
    if (idOrSlug === null) {
      return res.status(400).json({
        error: "Invalid category id or slug",
        code: ErrorCodes.VALIDATION_ERROR,
      });
    }

    const { data, error, status } = await discourseCategory({ idOrSlug });
    if (error || !data) {
      const upstreamStatus = status ?? 502;
      const statusCode = upstreamStatus >= 500 ? 502 : upstreamStatus;
      const payload: ApiErrorResponse = {
        error: error ?? "Failed to fetch category",
        code: ErrorCodes.UPSTREAM_ERROR,
      };
      return res.status(statusCode).json(payload);
    }

    return res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[discourse/categories/id] Request failed", {
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
