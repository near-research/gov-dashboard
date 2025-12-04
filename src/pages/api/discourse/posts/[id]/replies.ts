import type { NextApiRequest, NextApiResponse } from "next";
import { DISCOURSE_RENDER_LIMIT } from "@/config/discourse";
import { discourseReplies } from "@/server/plugins/discourse-client";

const parseId = (value: string | string[] | undefined): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
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

  const { data, error, status } = await discourseReplies({ postId });

  if (error || !data) {
    return res
      .status(status ?? 500)
      .json({ error: error ?? "Failed to fetch replies" });
  }

  const responseData: any = { ...data };
  if (Array.isArray(responseData.posts)) {
    responseData.posts = responseData.posts.slice(0, DISCOURSE_RENDER_LIMIT);
  }

  return res.status(200).json(responseData);
}
