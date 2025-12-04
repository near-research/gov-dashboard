import type { NextApiRequest, NextApiResponse } from "next";
import { discourseCategories } from "@/server/plugins/discourse-client";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { data, error, status } = await discourseCategories();
  if (error || !data) {
    return res
      .status(status ?? 500)
      .json({ error: error ?? "Failed to fetch categories" });
  }

  return res.status(200).json(data);
}
