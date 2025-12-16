import type { NextApiRequest, NextApiResponse } from "next";
import { DISCOURSE_RENDER_LIMIT } from "@/config/discourse";
import { servicesConfig } from "@/config/services";
import { ErrorCodes } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { DiscourseTopicDetailSchema } from "@/server/plugins/discourse-schemas";
import type { ApiErrorResponse } from "@/types/api";
import type { TopicsResponse } from "@/types/api/discourse";

const parseId = (value: string | string[] | undefined): number | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const buildError = (
  message: string,
  code: string,
  status: number,
  details?: unknown
) => ({
  status,
  payload: {
    error: message,
    code,
    details,
  } as ApiErrorResponse,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TopicsResponse>
) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", ["GET"]);
      const err = buildError(
        "Method not allowed",
        ErrorCodes.METHOD_NOT_ALLOWED,
        405
      );
      return res.status(err.status).json(err.payload);
    }

    const topicId = parseId(req.query.id);
    if (!topicId) {
      return res.status(400).json({
        error: "Invalid topic id",
        code: ErrorCodes.VALIDATION_ERROR,
      });
    }

    const topicResponse = await fetch(
      `${servicesConfig.discourseBaseUrl}/t/${topicId}.json`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!topicResponse.ok) {
      const { status } = topicResponse;
      return res.status(status).json({
        error: "Failed to fetch topic",
        code: ErrorCodes.UPSTREAM_ERROR,
      });
    }

    const remoteData = await topicResponse.json();
    const parsed = DiscourseTopicDetailSchema.safeParse(remoteData);
    if (!parsed.success) {
      const payload: ApiErrorResponse = {
        error: "Invalid Discourse topic response",
        code: ErrorCodes.UPSTREAM_ERROR,
        details: {
          issues: parsed.error.issues,
          topicId,
        },
      };
      return res.status(502).json(payload);
    }

    const topicData = parsed.data;
    const limitedPostStream = {
      ...topicData.post_stream,
      posts: topicData.post_stream.posts.slice(0, DISCOURSE_RENDER_LIMIT),
    };

    return res.status(200).json({
      ...topicData,
      post_stream: limitedPostStream,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to proxy Discourse topic:", error);
    return res.status(500).json({
      error: "Failed to proxy Discourse topic",
      code: ErrorCodes.INTERNAL_ERROR,
      details: message,
    });
  }
}
