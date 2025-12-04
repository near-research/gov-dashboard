import type { NextApiRequest, NextApiResponse } from "next";
import { registerVerificationSession } from "@/verification/server";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { verificationId } = req.body ?? {};
  if (!verificationId || typeof verificationId !== "string") {
    return res.status(400).json({ error: "verificationId required" });
  }

  const session = registerVerificationSession(verificationId);
  return res.status(200).json({
    verificationId,
    nonce: session.nonce,
    expiresAt: session.expiresAt,
  });
}
