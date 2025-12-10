import type { NextApiRequest, NextApiResponse } from "next";
import { getNearAIClient } from "@/lib/near-ai";
import { rateLimit } from "@/lib/rate-limit";
import type { VerificationSession } from "@/types/verification";

type SuccessResponse = VerificationSession & { verificationId: string };
type ErrorResponse = { error: string };

const limiter = rateLimit({
  interval: 60 * 1000,
  uniqueTokenPerInterval: 500,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const forwarded = req.headers["x-forwarded-for"];
  const identifier = (typeof forwarded === "string"
    ? forwarded.split(",")[0].trim()
    : typeof forwarded === "object" && forwarded && forwarded.length
    ? String(forwarded[0])
    : undefined) || req.socket?.remoteAddress || "anonymous";

  try {
    await limiter.check(res, 20, identifier);
  } catch {
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  const { verificationId } = req.body ?? {};

  if (!verificationId || typeof verificationId !== "string") {
    return res.status(400).json({ error: "verificationId required" });
  }

  try {
    const client = getNearAIClient();
    const session = client.createSession(verificationId);

    return res.status(200).json({
      verificationId,
      ...session,
    });
  } catch (error) {
    console.error("[verification/session] Error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create session",
    });
  }
}
