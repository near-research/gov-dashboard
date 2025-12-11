import type { NextApiRequest, NextApiResponse } from "next";
import { getNearAIClient } from "@/lib/near-ai";
import { normalizeVerificationResult } from "@/utils/verification/shared";

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

    const normalizedResult = normalizeVerificationResult(result);

    return res.status(200).json({
      attestation: result.attestation ?? null,
      signature: result.signature ?? null,
      signatureVerification: result.signatureVerification ?? null,
      nras: result.nras ?? null,
      nonceCheck: result.nonceCheck ?? null,
      intel: result.intel ?? null,
      attestationNodes: result.attestationNodes ?? null,
      configMissing: result.configMissing ?? undefined,
      verified: result.verified,
      reasons: result.reasons ?? [],
      results: result.results ?? null,
      requestHash: finalRequestHash ?? null,
      responseHash: finalResponseHash ?? null,
      sessionRequestHash: session.requestHash ?? null,
      sessionResponseHash: session.responseHash ?? null,
      normalized: normalizedResult,
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
