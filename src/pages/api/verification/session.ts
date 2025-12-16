import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";

import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";

type VerificationSession = {
  nonce: string;
  requestHash: string | null;
  responseHash: string | null;
  createdAt: number;
  expiresAt: number;
};

type SessionOverrides = {
  nonce?: string;
  requestHash?: string | null;
  responseHash?: string | null;
};

const SESSION_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

declare global {
  var __verificationSessionsCache: Map<string, VerificationSession> | undefined;
  var __verificationSessionCleanupStarted: boolean | undefined;
}

if (!globalThis.__verificationSessionsCache) {
  globalThis.__verificationSessionsCache = new Map<string, VerificationSession>();
}

export const sessionsCache = globalThis.__verificationSessionsCache;

if (!globalThis.__verificationSessionCleanupStarted) {
  globalThis.__verificationSessionCleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessionsCache) {
      if (session.expiresAt < now) {
        sessionsCache.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

const isHexNonce = (value?: string): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);

const buildSession = (
  verificationId: string,
  overrides?: SessionOverrides
): VerificationSession => {
  const now = Date.now();
  const existing = sessionsCache.get(verificationId);

  if (existing && existing.expiresAt > now) {
    const session: VerificationSession = {
      nonce: overrides?.nonce ?? existing.nonce,
      requestHash: overrides?.requestHash ?? existing.requestHash,
      responseHash: overrides?.responseHash ?? existing.responseHash,
      createdAt: existing.createdAt,
      expiresAt: now + SESSION_TTL_MS,
    };
    sessionsCache.set(verificationId, session);
    return session;
  }

  const nonce =
    overrides?.nonce && isHexNonce(overrides.nonce)
      ? overrides.nonce
      : randomBytes(32).toString("hex");

  const session: VerificationSession = {
    nonce,
    requestHash: overrides?.requestHash ?? null,
    responseHash: overrides?.responseHash ?? null,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };

  sessionsCache.set(verificationId, session);
  return session;
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respondWithError(
      res,
      new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405)
    );
  }

  const {
    verificationId,
    nonce: overrideNonce,
    requestHash: overrideRequestHash,
    responseHash: overrideResponseHash,
    attestedNonce,
  } = req.body ?? {};

  if (typeof verificationId !== "string" || !verificationId.trim()) {
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        "verificationId is required",
        400
      )
    );
  }

  let session = buildSession(verificationId, {
    nonce: overrideNonce,
    requestHash: overrideRequestHash,
    responseHash: overrideResponseHash,
  });

  if (isHexNonce(attestedNonce)) {
    session = {
      ...session,
      nonce: attestedNonce,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    sessionsCache.set(verificationId, session);
  }

  return res.status(200).json({
    verificationId,
    nonce: session.nonce,
    requestHash: session.requestHash,
    responseHash: session.responseHash,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  });
}
