import type { NextApiRequest, NextApiResponse } from "next";
import { DISCOURSE_RENDER_LIMIT } from "@/config/discourse";
import { discourseTopic } from "@/server/plugins/discourse-client";

const parseId = (value: string | string[] | undefined): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const cloneData = <T>(data: T): T => {
  try {
    return structuredClone(data);
  } catch {
    return JSON.parse(JSON.stringify(data));
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const topicId = parseId(req.query.id);
  if (!topicId) {
    return res.status(400).json({ error: "Invalid topic id" });
  }

  const { data, error, status } = await discourseTopic({ topicId });
  if (error || !data) {
    return res
      .status(status ?? 500)
      .json({ error: error ?? "Failed to fetch topic" });
  }

  const responseData = cloneData(data) as any;
  if (Array.isArray(responseData.posts)) {
    responseData.posts = responseData.posts.slice(0, DISCOURSE_RENDER_LIMIT);
  }
  if (Array.isArray(responseData.post_stream?.posts)) {
    responseData.post_stream = {
      ...responseData.post_stream,
      posts: responseData.post_stream.posts.slice(0, DISCOURSE_RENDER_LIMIT),
    };
  }

  return res.status(200).json(responseData);
}
