import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { servicesConfig } from "@/config/services";
import { logger } from "@/lib/logger";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";

const discourseUserSchema = z
  .object({
    user: z
      .object({
        id: z.number(),
        username: z.string(),
        name: z.string().optional(),
        avatar_template: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { username } = req.query;

    if (req.method !== "GET") {
      res.setHeader("Allow", ["GET"]);
      return respondWithError(
        res,
        new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method Not Allowed", 405)
      );
    }

    if (!username || Array.isArray(username)) {
      return respondWithError(
        res,
        new ApiError(ErrorCodes.VALIDATION_ERROR, "Username is required", 400)
      );
    }

    const apiKey = process.env.DISCOURSE_API_KEY;
    const apiUsername =
      process.env.DISCOURSE_API_USERNAME || process.env.DISCOURSE_API_USER;

    if (!apiKey || !apiUsername) {
      logger.error("Discourse API credentials are not configured.");
      throw new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Discourse credentials not configured",
        500
      );
    }

    const remoteResponse = await fetch(
      `${servicesConfig.discourseBaseUrl}/u/${encodeURIComponent(
        username
      )}.json`,
      {
        headers: {
          Accept: "application/json",
          "Api-Key": apiKey,
          "Api-Username": apiUsername,
        },
      }
    );

    if (!remoteResponse.ok) {
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        `Failed to fetch user data (${remoteResponse.status})`,
        remoteResponse.status
      );
    }

    const data = await remoteResponse.json();
    const parsed = discourseUserSchema.safeParse(data);

    if (!parsed.success) {
      throw new ApiError(
        ErrorCodes.UPSTREAM_ERROR,
        "Discourse user response validation failed",
        502,
        { issues: parsed.error.issues }
      );
    }

    return res.status(200).json(parsed.data);
  } catch (error) {
    logger.error("Failed to proxy discourse user data:", error);
    if (error instanceof Error) {
      return respondWithError(res, error);
    }
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to proxy discourse user data",
        500,
        typeof error === "string" ? error : undefined
      )
    );
  }
}
