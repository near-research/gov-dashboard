import type { NextApiRequest, NextApiResponse } from "next";
import { RPCHandler } from "@orpc/server/node";
import { router } from "@/lib/router";

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

    // Handle the request
    const { matched } = await handler.handle(req, res, {
      prefix: "/api/rpc",
      context: {
        session: {
          user: { data: "logged in user" },
        },
      },
    });

    if (matched) {
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  } catch (error: any) {
    console.error("=== [oRPC] ERROR START ===");
    console.error("[oRPC] Error:", error);
    console.error("[oRPC] Message:", error?.message);
    console.error("[oRPC] Stack:", error?.stack);
    console.error("[oRPC] Cause:", error?.cause);

    if (error?.data) {
      console.error("[oRPC] Data:", JSON.stringify(error.data, null, 2));
    }
    console.error("[oRPC] Error:", error);

    res.statusCode = 500;
    res.end("Internal server error");
  }
}
