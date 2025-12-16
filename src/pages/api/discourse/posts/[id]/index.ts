import type { NextApiRequest, NextApiResponse } from "next";
import { ErrorCodes } from "@/lib/api/errors";
import { discoursePost } from "@/server/plugins/discourse-client";
import type { ApiErrorResponse } from "@/types/api";
import type { PostsResponse } from "@/types/api/discourse";

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
  res: NextApiResponse<PostsResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed",
      code: ErrorCodes.METHOD_NOT_ALLOWED,
    });
  }

  const postId = parseId(req.query.id);
  if (!postId) {
    return res.status(400).json({
      error: "Invalid post id",
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }

  const includeRaw = parseBoolean(req.query.include_raw) ?? undefined;
  if (req.query.include_raw !== undefined && includeRaw === null) {
    return res.status(400).json({
      error: "Invalid `include_raw` parameter",
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }

  const { data, error, status } = await discoursePost({
    postId,
    includeRaw,
  });

  if (error || !data) {
    const upstreamStatus = status ?? 502;
    const statusCode = upstreamStatus >= 500 ? 502 : upstreamStatus;
    const payload: ApiErrorResponse = {
      error: error ?? "Failed to fetch post",
      code: ErrorCodes.UPSTREAM_ERROR,
    };
    return res.status(statusCode).json(payload);
  }

  return res.status(200).json(data);
}
