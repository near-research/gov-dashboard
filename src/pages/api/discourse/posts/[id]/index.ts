import type { NextApiRequest, NextApiResponse } from "next";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
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
      new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405)
    );
  }

  const postId = parseId(req.query.id);
  if (!postId) {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid post id", 400)
    );
  }

  const includeRaw = parseBoolean(req.query.include_raw) ?? undefined;
  if (req.query.include_raw !== undefined && includeRaw === null) {
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid `include_raw` parameter",
        400
      )
    );
  }

  const { data, error, status } = await discoursePost({
    postId,
    includeRaw,
  });

  if (error || !data) {
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        error ?? "Failed to fetch post",
        status ?? 500
      )
    );
  }

  return res.status(200).json(data);
}
