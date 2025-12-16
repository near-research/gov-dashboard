import type { NextApiRequest, NextApiResponse } from "next";

import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { sessionsCache } from "./session";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respondWithError(
      res,
      new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405)
    );
  }

  const { verificationId } = req.body ?? {};

  if (typeof verificationId !== "string" || !verificationId.trim()) {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.VALIDATION_ERROR, "verificationId is required", 400)
    );
  }

  const session = sessionsCache.get(verificationId);

  if (!session) {
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.NOT_FOUND,
        "Verification session not found",
        404
      )
    );
  }

  return res.status(200).json({
    verificationId,
    nonce: session.nonce,
    requestHash: session.requestHash,
    responseHash: session.responseHash,
    verified: Boolean(session.requestHash && session.responseHash),
  });
}
