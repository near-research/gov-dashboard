import type { NextApiRequest, NextApiResponse } from "next";
import type { DiscourseSearchResponse } from "../../../../discourse-plugin";
import {
  DISCOURSE_PROPOSALS_CATEGORY_ID,
  clampPageSize,
  clampRenderLimit,
} from "@/config/discourse";
import { discourseSearch } from "@/server/plugins/discourse-client";

const SUPPORTED_PARAMS = new Set([
  "q",
  "page",
  "limit",
  "per_page",
  "category",
  "username",
  "tags",
  "before",
  "after",
  "order",
  "status",
  "in",
  "userApiKey",
]);

const parsePositiveInt = (
  value: string | string[] | undefined
): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const parsePage = (value: string | string[] | undefined): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return parsed;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DiscourseSearchResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const unknownParams = Object.keys(req.query).filter(
    (key) => !SUPPORTED_PARAMS.has(key)
  );
  if (unknownParams.length) {
    return res.status(400).json({
      error: `Unsupported parameter(s): ${unknownParams.join(", ")}`,
    });
  }

  const queryParam = req.query.q;
  if (!queryParam || (Array.isArray(queryParam) && queryParam.length === 0)) {
    return res.status(400).json({ error: "Missing search query `q`" });
  }

  if (Array.isArray(queryParam)) {
    return res
      .status(400)
      .json({ error: "Multiple `q` parameters provided. Use a single value." });
  }

  const trimmedQuery = queryParam.trim();
  if (!trimmedQuery) {
    return res.status(400).json({ error: "Search query cannot be empty" });
  }

  const rawLimit = req.query.limit ?? req.query.per_page;
  const limitParam = parsePositiveInt(rawLimit);
  if (rawLimit !== undefined && limitParam === null) {
    return res.status(400).json({ error: "Invalid `limit` parameter" });
  }

  const pageParam = parsePage(req.query.page);
  if (req.query.page !== undefined && pageParam === null) {
    return res.status(400).json({ error: "Invalid `page` parameter" });
  }

  const tagsParam = req.query.tags;
  if (Array.isArray(tagsParam)) {
    return res
      .status(400)
      .json({ error: "Use a comma-separated `tags` string" });
  }

  const limit = clampPageSize(limitParam);
  const renderLimit = clampRenderLimit(limitParam);
  const headers = req.headers ?? {};
  const userApiKey =
    typeof req.query.userApiKey === "string" &&
    req.query.userApiKey.trim().length > 0
      ? req.query.userApiKey
      : typeof headers["x-discourse-user-api-key"] === "string"
      ? headers["x-discourse-user-api-key"]
      : undefined;

  const { data, error, status } = await discourseSearch({
    query: trimmedQuery,
    limit,
    page: pageParam ?? undefined,
    category:
      typeof req.query.category === "string"
        ? req.query.category
        : DISCOURSE_PROPOSALS_CATEGORY_ID.toString(),
    username:
      typeof req.query.username === "string" ? req.query.username : undefined,
    tags: tagsParam
      ? tagsParam
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : undefined,
    before: typeof req.query.before === "string" ? req.query.before : undefined,
    after: typeof req.query.after === "string" ? req.query.after : undefined,
    order:
      typeof req.query.order === "string" &&
      ["likes", "latest", "views", "latest_topic"].includes(req.query.order)
        ? (req.query.order as "likes" | "latest" | "views" | "latest_topic")
        : undefined,
    status:
      typeof req.query.status === "string" &&
      [
        "closed",
        "open",
        "public",
        "archived",
        "noreplies",
        "solved",
        "unsolved",
      ].includes(req.query.status)
        ? (req.query.status as
            | "closed"
            | "open"
            | "public"
            | "archived"
            | "noreplies"
            | "solved"
            | "unsolved")
        : undefined,
    in:
      typeof req.query.in === "string" &&
      [
        "title",
        "messages",
        "created",
        "likes",
        "personal",
        "seen",
        "unseen",
        "posted",
        "watching",
        "tracking",
        "bookmarks",
        "first",
        "pinned",
        "wiki",
      ].includes(req.query.in)
        ? (req.query.in as
            | "title"
            | "messages"
            | "created"
            | "likes"
            | "personal"
            | "seen"
            | "unseen"
            | "posted"
            | "watching"
            | "tracking"
            | "bookmarks"
            | "first"
            | "pinned"
            | "wiki")
        : undefined,
    userApiKey,
  });

  if (error || !data) {
    return res
      .status(status ?? 500)
      .json({ error: error ?? "Failed to search Discourse" });
  }

  const topics = Array.isArray(data.topics) ? data.topics : [];
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const responseData: DiscourseSearchResponse = {
    ...data,
    topics: topics.slice(0, renderLimit),
    posts: posts.slice(0, renderLimit),
  };

  return res.status(200).json(responseData);
}
