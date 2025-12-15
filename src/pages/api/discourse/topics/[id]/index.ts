import type { NextApiRequest, NextApiResponse } from "next";
import { DISCOURSE_RENDER_LIMIT } from "@/config/discourse";
import { servicesConfig } from "@/config/services";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { DiscourseTopicDetailSchema } from "@/server/plugins/discourse-schemas";

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
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", ["GET"]);
      return respondWithError(
        res,
        new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405)
      );
    }

    const topicId = parseId(req.query.id);
    if (!topicId) {
      return respondWithError(
        res,
        new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid topic id", 400)
      );
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
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        "Failed to fetch topic",
        topicResponse.status
      );
    }

    const remoteData = await topicResponse.json();
    const parsed = DiscourseTopicDetailSchema.safeParse(remoteData);
    if (!parsed.success) {
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        "Invalid Discourse topic response",
        502,
        {
          issues: parsed.error.issues,
          topicId,
        }
      );
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
    logger.error("Failed to proxy Discourse topic:", error);
    if (error instanceof Error) {
      return respondWithError(res, error);
    }
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to proxy Discourse topic",
        500,
        typeof error === "string" ? error : undefined
      )
    );
  }
}
