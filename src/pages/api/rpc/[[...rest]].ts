import type { NextApiRequest, NextApiResponse } from "next";
import { RPCHandler } from "@orpc/server/node";
import { router } from "@/lib/router";
import { createContext } from "@/lib/context";
import { logger } from "@/lib/logger";

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : typeof error === "string" && error.length > 0
    ? error
    : "Unknown error";


export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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
  } catch (error: unknown) {
    logger.error("=== [oRPC] ERROR START ===");
    logger.error("[oRPC] Error:", error);
    logger.error("[oRPC] Message:", getErrorMessage(error));
    if (error instanceof Error) {
      logger.error("[oRPC] Stack:", error.stack);
      logger.error("[oRPC] Cause:", error.cause);
    }

    const record = toRecord(error);
    if (record?.data) {
      logger.error("[oRPC] Data:", JSON.stringify(record.data, null, 2));
    }
    logger.error("[oRPC] Error:", error);

    res.statusCode = 500;
    res.end("Internal server error");
  }
}
