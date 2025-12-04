import type { NextApiRequest, NextApiResponse } from "next";
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
    return res.status(405).json({ error: "Method not allowed" });
  }

  const postId = parseId(req.query.id);
  if (!postId) {
    return res.status(400).json({ error: "Invalid post id" });
  }

  const includeRaw = parseBoolean(req.query.include_raw) ?? undefined;
  if (req.query.include_raw !== undefined && includeRaw === null) {
    return res.status(400).json({ error: "Invalid `include_raw` parameter" });
  }

  const { data, error, status } = await discoursePost({
    postId,
    includeRaw,
  });

  if (error || !data) {
    return res
      .status(status ?? 500)
      .json({ error: error ?? "Failed to fetch post" });
  }

  return res.status(200).json(data);
}
