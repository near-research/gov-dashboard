import type { NextApiRequest, NextApiResponse } from "next";
import { getNearAIClient } from "@/lib/near-ai";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    verificationId,
    model,
    chatId,
    requestHash,
    responseHash,
  } = req.body ?? {};

  if (!verificationId) {
    return res.status(400).json({ error: "verificationId is required" });
  }

  const client = getNearAIClient();
  const session = client.getSession(verificationId);

  if (!session) {
    return res.status(400).json({
      error: "Verification session not found or expired",
    });
  }

  const finalRequestHash = requestHash || session.requestHash;
  const finalResponseHash = responseHash || session.responseHash;

  if (
    requestHash &&
    session.requestHash &&
    requestHash !== session.requestHash
  ) {
    return res.status(400).json({
      error: "Provided request hash conflicts with session",
    });
  }

  if (
    responseHash &&
    session.responseHash &&
    responseHash !== session.responseHash
  ) {
    return res.status(400).json({
      error: "Provided response hash conflicts with session",
    });
  }

  try {
    const result = await client.verify({
      verificationId,
      model,
      chatId,
      requestHash: finalRequestHash ?? undefined,
      responseHash: finalResponseHash ?? undefined,
    });

    if (!result.verified) {
      console.warn("[verification/proof] Verification failed:", result.reasons);
    }

    return res.status(200).json({
      verified: result.verified,
      reasons: result.reasons,
      nras: result.nras,
      signature: result.signature,
      nonceCheck: result.nonceCheck,
      requestHash: finalRequestHash,
      responseHash: finalResponseHash,
      nonce: session.nonce,
    });
  } catch (error) {
    console.error("[verification/proof] Error:", error);
    return res.status(500).json({
      error: "Verification failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
