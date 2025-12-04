import { randomBytes } from "crypto";

export type VerificationSession = {
  nonce: string;
  createdAt: number;
  expiresAt: number;
  requestHash?: string | null;
  responseHash?: string | null;
};

type GlobalWithSessions = typeof globalThis & {
  __verificationSessions?: Map<string, VerificationSession>;
};

// Share a single in-memory store across module reloads/workers so tests and API
// handlers operate on the same session state.
const getSessionStore = () => {
  const g = globalThis as GlobalWithSessions;
  if (!g.__verificationSessions) {
    g.__verificationSessions = new Map<string, VerificationSession>();
  }
  return g.__verificationSessions;
};

const SESSIONS = getSessionStore();
export const TTL_MS = 5 * 60 * 1000; // 5 minutes – matches NEAR proof availability window

const isExpired = (session: VerificationSession) => Date.now() > session.expiresAt;

export function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of SESSIONS.entries()) {
    if (now > session.expiresAt) {
      SESSIONS.delete(id);
    }
  }
}

export function getVerificationSession(verificationId: string): VerificationSession | null {
  cleanupExpiredSessions();
  const existing = SESSIONS.get(verificationId);
  return existing && !isExpired(existing) ? existing : null;
}

const isHex64 = (value: string) => /^[0-9a-f]{64}$/i.test(value);
const generateNonce = () => randomBytes(32).toString("hex");

export function registerVerificationSession(
  verificationId: string,
  nonce?: string,
  requestHash?: string | null,
  responseHash?: string | null
): VerificationSession {
  const existing = getVerificationSession(verificationId);
  if (existing) {
    const merged = {
      ...existing,
      requestHash: existing.requestHash ?? requestHash ?? null,
      responseHash: existing.responseHash ?? responseHash ?? null,
    };
    SESSIONS.set(verificationId, merged);
    return merged;
  }

  const generated = nonce && isHex64(nonce) ? nonce : generateNonce();
  const session: VerificationSession = {
    nonce: generated,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
    requestHash: requestHash ?? null,
    responseHash: responseHash ?? null,
  };
  SESSIONS.set(verificationId, session);
  return session;
}

export function updateVerificationHashes(
  verificationId: string,
  hashes: { requestHash?: string | null; responseHash?: string | null }
) {
  const existing = getVerificationSession(verificationId);
  if (!existing) return;
  SESSIONS.set(verificationId, {
    ...existing,
    requestHash: hashes.requestHash ?? existing.requestHash ?? null,
    responseHash: hashes.responseHash ?? existing.responseHash ?? null,
  });
}

export function clearVerificationSession(verificationId: string) {
  SESSIONS.delete(verificationId);
}

export function syncVerificationNonce(
  verificationId: string,
  nonce: string,
  requestHash?: string | null,
  responseHash?: string | null
): VerificationSession | null {
  const existing = getVerificationSession(verificationId);
  const now = Date.now();

  if (!isHex64(nonce)) {
    console.warn("[verification] Rejected weak/invalid nonce override", {
      verificationId,
    });
    return existing ?? null;
  }

  if (existing && existing.nonce !== nonce) {
    console.warn("[verification] Rejected nonce override attempt", {
      verificationId,
    });
    return existing;
  }

  const merged: VerificationSession = {
    nonce: existing?.nonce ?? nonce,
    createdAt: existing?.createdAt ?? now,
    expiresAt: now + TTL_MS,
    requestHash: requestHash ?? existing?.requestHash ?? null,
    responseHash: responseHash ?? existing?.responseHash ?? null,
  };
  SESSIONS.set(verificationId, merged);
  return merged;
}

// Automatic periodic cleanup
const CLEANUP_INTERVAL_MS = 60 * 1000;
if (typeof setInterval === "function") {
  setInterval(() => cleanupExpiredSessions(), CLEANUP_INTERVAL_MS).unref?.();
}
