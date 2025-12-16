import type { NextApiRequest, NextApiResponse } from "next";
import type {
  DiscourseLatestPost,
  DiscourseLatestPostsResponse,
} from "../../../../discourse-plugin";
import {
  DISCOURSE_PROPOSALS_CATEGORY_ID,
  DISCOURSE_MAX_PER_PAGE,
  clampPageSize,
  clampRenderLimit,
} from "@/config/discourse";
import { discourseLatestTopics } from "@/server/plugins/discourse-client";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

const SUPPORTED_PARAMS = new Set([
  "per_page",
  "page",
  "order",
  "category_id",
  "userApiKey",
]);

const stripHtml = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parsePositiveInt = (
  value: string | string[] | undefined,
  { allowZero = false }: { allowZero?: boolean } = {}
): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return null;
  if (!allowZero && parsed <= 0) return null;
  if (allowZero && parsed < 0) return null;
  return parsed;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DiscourseLatestPostsResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.METHOD_NOT_ALLOWED,
        "Only GET requests are allowed",
        405
      )
    );
  }

  try {
    const unknownParams = Object.keys(req.query).filter(
      (key) => !SUPPORTED_PARAMS.has(key)
    );
    if (unknownParams.length) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        `Unsupported parameter(s): ${unknownParams.join(", ")}`,
        400
      );
    }

    const perPageInput = parsePositiveInt(req.query.per_page);
    const perPage = perPageInput === null ? null : clampPageSize(perPageInput);
    if (req.query.per_page !== undefined && perPage === null) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid `per_page` parameter",
        400
      );
    }

    const page = parsePositiveInt(req.query.page, { allowZero: true });
    if (req.query.page !== undefined && page === null) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid `page` parameter",
        400
      );
    }

    const allowedOrders = [
      "default",
      "created",
      "activity",
      "views",
      "posts",
      "likes",
    ] as const;
    type AllowedOrder = (typeof allowedOrders)[number];
    const order: AllowedOrder | undefined =
      typeof req.query.order === "string" &&
      allowedOrders.includes(req.query.order as AllowedOrder)
        ? (req.query.order as AllowedOrder)
        : undefined;
    if (req.query.order !== undefined && !order) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid order. Supported values: ${allowedOrders.join(", ")}`,
        400
      );
    }

    const categoryId = parsePositiveInt(req.query.category_id);
    if (req.query.category_id !== undefined && categoryId === null) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid `category_id` parameter",
        400
      );
    }

    const pageSize = perPage ?? DISCOURSE_MAX_PER_PAGE;
    const renderLimit = clampRenderLimit(perPage ?? undefined);

    const { data, error, status } = await discourseLatestTopics({
      page: page ?? undefined,
      order,
      categoryId: categoryId ?? DISCOURSE_PROPOSALS_CATEGORY_ID,
    });

    if (error || !data) {
      const upstreamStatus = status ?? 502;
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        error ?? "Failed to fetch latest topics",
        upstreamStatus >= 500 ? 502 : upstreamStatus
      );
    }

    const latestPosts: DiscourseLatestPost[] =
      data.topics?.slice(0, renderLimit).map((topic) => ({
        id: topic.id,
        title: topic.title,
        excerpt: stripHtml(topic.excerpt ?? "").slice(0, 200),
        created_at: topic.createdAt ?? "",
        username: topic.username ?? "unknown",
        topic_id: topic.id,
        topic_slug: topic.slug,
        reply_count: topic.replyCount,
        views: topic.views,
        last_posted_at: topic.lastPostedAt ?? topic.createdAt ?? "",
        like_count: topic.likeCount,
        posts_count: topic.postsCount,
        pinned: topic.pinned,
        closed: topic.closed,
        archived: topic.archived,
        visible: topic.visible,
        category_id: topic.categoryId,
      })) ?? [];

    return res.status(200).json({
      latest_posts: latestPosts,
      can_create_topic: data.canCreateTopic ?? false,
      per_page: renderLimit,
    });
  } catch (error) {
    logger.error("[discourse/latest] Request failed", {
      error: error instanceof Error ? error.message : String(error),
      query: req.query,
    });

    if (error instanceof ApiError || error instanceof Error) {
      return respondWithError(res, error);
    }

    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Discourse request failed",
        500
      )
    );
  }
}
