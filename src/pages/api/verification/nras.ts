import type { NextApiRequest, NextApiResponse } from "next";
import { getNearAIClient } from "@/lib/near-ai";

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

  try {
    const client = getNearAIClient();
    const result = await client.verifyWithNras(attestation, nonce || "");

    return res.status(200).json(result);
  } catch (error) {
    console.error("[verification/nras] Error:", error);
    return res.status(200).json({
      verified: false,
      reasons: [
        error instanceof Error
          ? error.message
          : "NRAS verification failed",
      ],
    });
  }
}

export function resetJwksCache() {
  // no-op kept for backwards compatibility
}
