import type { NextApiRequest, NextApiResponse } from "next";
import {
  registerVerificationSession,
  getVerificationSession,
  syncVerificationNonce,
} from "@/verification/server";

type SessionResponse = {
  verificationId: string;
  nonce: string;
  requestHash?: string | null;
  responseHash?: string | null;
  expiresAt: number;
  createdAt: number;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<SessionResponse | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { verificationId, nonce, requestHash, responseHash, attestedNonce } = req.body ?? {};

  if (!verificationId || typeof verificationId !== "string") {
    return res.status(400).json({ error: "verificationId is required" });
  }

  let session =
    getVerificationSession(verificationId) ||
    registerVerificationSession(verificationId, nonce, requestHash, responseHash);

  if (attestedNonce && attestedNonce !== session?.nonce) {
    session =
      syncVerificationNonce(verificationId, attestedNonce, requestHash, responseHash) || session;
  }

  return res.status(200).json({
    verificationId,
    nonce: session.nonce,
    requestHash: session.requestHash ?? requestHash ?? null,
    responseHash: session.responseHash ?? responseHash ?? null,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
  });
}
