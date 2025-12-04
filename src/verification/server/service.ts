import { createHash } from "crypto";
import {
  registerVerificationSession,
  updateVerificationHashes,
} from "@/verification/server/sessions";
import { extractHashesFromSignedText } from "@/verification/hash-utils";
import { normalizeSignaturePayload } from "@/verification/normalize";

const NEAR_API_BASE = "https://cloud-api.near.ai/v1";
const SIGNATURE_FETCH_TIMEOUT_MS = 5000;
const MAX_SIGNATURE_FETCH_ATTEMPTS = 2;

type CanonicalHashes = { requestHash: string; responseHash: string };
type SignatureCacheEntry = { expiresAt: number; hashes: CanonicalHashes | null };
const signatureCache = new Map<string, SignatureCacheEntry>(); // kept for test hooks; not used for runtime caching
let MAX_SIGNATURE_CACHE_ENTRIES = 100;

export type VerificationStage = "initial_reasoning" | "final_synthesis";

export type VerificationPayload = {
  messageId: string;
  verificationId: string;
  requestHash: string;
  responseHash: string;
  nonce: string | null;
  stage: VerificationStage;
};

export const verificationService = {
  registerSession: ({
    verificationId,
    nonce,
    requestHash,
    responseHash,
  }: {
    verificationId?: string;
    nonce?: string;
    requestHash?: string | null;
    responseHash?: string | null;
  }) => {
    if (!verificationId) return null;
    return registerVerificationSession(
      verificationId,
      nonce,
      requestHash,
      responseHash
    );
  },

  updateHashes: (
    verificationId: string,
    hashes: { requestHash?: string | null; responseHash?: string | null }
  ) => {
    updateVerificationHashes(verificationId, hashes);
  },

  finalizeStage: async ({
    verificationId,
    remoteMessageId,
    nonce,
    model,
    stage,
    signingAlgo,
  }: {
    verificationId?: string;
    remoteMessageId?: string;
    nonce?: string;
    model: string;
    stage: VerificationStage;
    signingAlgo?: string;
  }): Promise<VerificationPayload | null> => {
    if (!verificationId || !remoteMessageId) {
      return null;
    }

    const canonicalHashes = await fetchCanonicalHashes(
      remoteMessageId,
      verificationId,
      model,
      signingAlgo
    );

    if (!canonicalHashes) {
      return null;
    }

    updateVerificationHashes(verificationId, canonicalHashes);

    return {
      messageId: remoteMessageId,
      verificationId,
      requestHash: canonicalHashes.requestHash,
      responseHash: canonicalHashes.responseHash,
      nonce: nonce ?? null,
      stage,
    };
  },
};

async function fetchCanonicalHashes(
  preferredId: string | undefined,
  fallbackId: string | undefined,
  model: string,
  signingAlgo?: string
): Promise<CanonicalHashes | null> {
  const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;
  if (!apiKey) {
    console.warn("[verificationService] NEAR_AI_CLOUD_API_KEY missing; skipping signature fetch");
    return null;
  }

  const candidates = Array.from(
    new Set(
      [preferredId, fallbackId].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      )
    )
  );

  if (candidates.length === 0) {
    return null;
  }

  const fetchWithTimeout = async (url: string, attempt: number) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      SIGNATURE_FETCH_TIMEOUT_MS
    );
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
      if (attempt < MAX_SIGNATURE_FETCH_ATTEMPTS - 1) {
        const backoff = 50 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  };

  for (const id of candidates) {
    try {
      const signatureUrl = `${NEAR_API_BASE}/signature/${encodeURIComponent(
        id
      )}?model=${encodeURIComponent(model)}&signing_algo=${encodeURIComponent(
        signingAlgo || "ecdsa"
      )}`;
      let response: Response | null = null;

      for (let attempt = 0; attempt < MAX_SIGNATURE_FETCH_ATTEMPTS; attempt++) {
        try {
          response = await fetchWithTimeout(signatureUrl, attempt);
          break;
        } catch (error) {
          if (attempt === MAX_SIGNATURE_FETCH_ATTEMPTS - 1) {
            throw error;
          }
        }
      }

      if (!response || !response.ok) {
        console.warn(
          `[verificationService] Failed to fetch signature for hash extraction (${id}): ${response?.status}`
        );
        continue;
      }

      const data = await response.json();
      const signaturePayload =
        normalizeSignaturePayload(data.signature ?? data) ||
        normalizeSignaturePayload(data);
      const signedText =
        signaturePayload?.text ||
        (typeof data?.text === "string" ? data.text : null);
      const hashes = extractHashesFromSignedText(signedText);

      if (hashes) {
        return hashes;
      }

      console.warn("[verificationService] Unable to parse hashes from signed text", {
        id,
      });
    } catch (error) {
      console.error("[verificationService] Error fetching canonical hashes:", error);
    }
  }

  return null;
}

export const computeRequestHash = (payload: string) => {
  if (typeof payload !== "string") {
    throw new TypeError(
      "computeRequestHash expects the exact serialized request string (no JSON.stringify)."
    );
  }
  return createHash("sha256").update(payload).digest("hex");
};

export const __signatureCacheTestHooks = {
  clear: () => signatureCache.clear(),
  size: () => signatureCache.size,
  keys: () => Array.from(signatureCache.keys()),
  cleanup: (now: number) => {
    for (const [key, entry] of signatureCache.entries()) {
      if (entry.expiresAt < now) {
        signatureCache.delete(key);
      }
    }
  },
  setEntry: (key: string, entry: SignatureCacheEntry) => {
    if (signatureCache.size >= MAX_SIGNATURE_CACHE_ENTRIES) {
      const first = signatureCache.keys().next().value;
      if (first) signatureCache.delete(first);
    }
    signatureCache.set(key, entry);
  },
  setMaxEntries: (max: number) => {
    MAX_SIGNATURE_CACHE_ENTRIES = max;
    while (signatureCache.size > MAX_SIGNATURE_CACHE_ENTRIES) {
      const first = signatureCache.keys().next().value;
      if (first) signatureCache.delete(first);
    }
  },
  resetMaxEntries: () => {
    MAX_SIGNATURE_CACHE_ENTRIES = 100;
  },
};

export type { SignatureCacheEntry };
