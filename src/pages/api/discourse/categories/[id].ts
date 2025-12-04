import type { NextApiRequest, NextApiResponse } from "next";
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
    return res.status(405).json({ error: "Method not allowed" });
  }

  const idOrSlug = parseIdOrSlug(req.query.id);
  if (idOrSlug === null) {
    return res.status(400).json({ error: "Invalid category id or slug" });
  }

  const { data, error, status } = await discourseCategory({ idOrSlug });
  if (error || !data) {
    return res
      .status(status ?? 500)
      .json({ error: error ?? "Failed to fetch category" });
  }

  return res.status(200).json(data);
}
