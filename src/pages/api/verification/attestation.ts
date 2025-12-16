import type { NextApiRequest, NextApiResponse } from "next";
import { fetchAttestation } from "@/lib/near-ai/verification/attestation";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const model = req.query.model as string | undefined;

  if (!model) {
    return res.status(400).json({ error: "model query param required" });
  }

  try {
    const attestation = await fetchAttestation(model, { bypassCache: true });

    return res.status(200).json({
      model,
      fetchedAt: new Date().toISOString(),
      teeAddresses: attestation.teeAddresses,
      hasNvidiaPayload: attestation.hasNvidiaPayload,
      raw: attestation.raw,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch attestation",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
