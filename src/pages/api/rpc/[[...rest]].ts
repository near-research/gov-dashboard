import type { NextApiRequest, NextApiResponse } from "next";
import { RPCHandler } from "@orpc/server/node";
import { router } from "@/lib/router";
import { createContext } from "@/lib/context";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.METHOD_NOT_ALLOWED,
        "Only POST requests are allowed",
        405
      )
    );
  }

  try {
    // Create handler with the router
    const handler = new RPCHandler(router);

    const context = await createContext(req);

    // Handle the request
    const { matched } = await handler.handle(req, res, {
      prefix: "/api/rpc",
      context,
    });

    if (matched) {
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  } catch (error) {
    logger.error("[rpc] Handler error", {
      error: error instanceof Error ? error.message : String(error),
      path: req.url,
    });
    const normalizedError =
      error instanceof ApiError || error instanceof Error
        ? error
        : new ApiError(
            ErrorCodes.INTERNAL_ERROR,
            "RPC handler failed",
            500,
            { details: error instanceof Error ? error.message : String(error) }
          );
    return respondWithError(res, normalizedError);
  }
}
