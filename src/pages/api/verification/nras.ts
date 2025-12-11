import type { NextApiRequest, NextApiResponse } from "next";
import { getNearAIClient } from "@/lib/near-ai";
import { detectAttestationType } from "@/utils/attestation/type-detection";

type NrasBody = {
  attestation?: unknown;
  nonce?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { attestation, nonce } = (req.body ?? {}) as NrasBody;

  if (!attestation) {
    return res.status(400).json({ error: "attestation is required" });
  }

  const attestationType = detectAttestationType(attestation);
  if (attestationType !== "nvidia") {
    return res
      .status(400)
      .json({ error: "NRAS verification only supports NVIDIA attestations" });
  }

  if (typeof nonce !== "string" || nonce.length === 0) {
    return res.status(400).json({ error: "nonce must be a non-empty string" });
  }

  try {
    const client = getNearAIClient();
    const result = await client.verifyWithNras(attestation, nonce);

    const payload: Record<string, unknown> = { verified: result.verified };
    if (result.verified) {
      if (result.claims) {
        payload.claims = result.claims;
      }
    } else {
      payload.reasons = result.reasons ?? ["NRAS verification failed"];
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error("[verification/nras] Error:", error);
    if (
      error instanceof Error &&
      /(network|fetch|timeout|unavailable)/i.test(error.message)
    ) {
      return res
        .status(502)
        .json({ error: "NRAS service unavailable" });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
}
