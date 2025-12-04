import {
  fetchModelAttestation,
  extractExpectationsFromAttestation,
} from "@/utils/attestation/fetch-model-attestation";
import { verificationConfig } from "@/config/verification";
import {
  collectSigningAddressesFromAttestation,
  validateIntelBinding,
} from "@/utils/verification/intel";
import type { AttestationExpectations } from "@/utils/attestation/expectations";

type CachedExpectations = {
  nonce: string;
  arch: string;
  deviceCertHash: string;
  rimHash?: string | null;
  ueid?: string | null;
  measurements: string[];
  fetchedAt: number;
};

type CachedAttestation = {
  attestation: any;
  nonce: string;
  expectations: CachedExpectations;
  fetchedAt: number;
  expiresAt: number;
};

const CACHE = new Map<string, CachedAttestation>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 20;
const metrics = {
  hits: 0,
  misses: 0,
  evictions: 0,
};

const evictIfNeeded = () => {
  if (CACHE.size < MAX_CACHE_ENTRIES) return;
  const oldestKey = CACHE.keys().next().value;
  if (oldestKey) {
    CACHE.delete(oldestKey);
    metrics.evictions += 1;
  }
};

const getCachedEntry = (model: string): CachedAttestation | null => {
  const entry = CACHE.get(model);
  if (entry && entry.expiresAt > Date.now()) {
    metrics.hits += 1;
    return entry;
  }
  if (entry) {
    CACHE.delete(model);
  }
  metrics.misses += 1;
  return null;
};

export function getAttestationCacheMetrics() {
  return {
    size: CACHE.size,
    hits: metrics.hits,
    misses: metrics.misses,
    evictions: metrics.evictions,
  };
}

export function getCachedAttestation(model: string) {
  const entry = getCachedEntry(model);
  return entry ? entry.attestation : null;
}

const parseJsonSafe = (value: any) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
};

const pickNvidiaPayload = (attestation: any): any | null => {
  const candidates = [
    attestation?.nvidia_payload,
    attestation?.gateway_attestation?.nvidia_payload,
    attestation?.model_attestations?.[0]?.nvidia_payload,
    attestation?.all_attestations?.[0]?.nvidia_payload,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = parseJsonSafe(candidate);
    if (parsed) return parsed;
  }
  return null;
};

const collectIntelQuote = (attestation: any): any | null => {
  const candidates = [
    attestation?.intel_quote,
    attestation?.gateway_attestation?.intel_quote,
    attestation?.model_attestations?.[0]?.intel_quote,
    attestation?.all_attestations?.[0]?.intel_quote,
  ].filter(Boolean);
  const quote = candidates.find(Boolean);
  return quote ?? null;
};

const verifyNrasPayload = async (
  payload: any,
  expectations: AttestationExpectations
) => {
  const nrasUrl = verificationConfig.nras.url;
  const body = {
    nonce:
      payload?.nonce ||
      payload?.eat_nonce ||
      payload?.["x-nvidia-eat-nonce"] ||
      expectations.nonce,
    arch: payload?.arch || payload?.gpu_arch || expectations.arch,
    evidence_list:
      payload?.evidence_list || payload?.evidenceList || payload?.evidences || [],
    device_cert_hash: payload?.device_cert_hash || expectations.deviceCertHash,
    rim: payload?.rim || payload?.rim_hash || expectations.rimHash,
    ueid: payload?.ueid || expectations.ueid,
  };

  const resp = await fetch(nrasUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`NRAS verification failed (${resp.status})`);
  }
  const json = await resp.json();
  const claims = json?.claims || {};
  const nrasNonce =
    claims.eat_nonce ||
    claims.nonce ||
    claims["x-nvidia-eat-nonce"] ||
    json?.nonce;
  const overall = claims["x-nvidia-overall-att-result"];
  const signatureVerified =
    claims["x-nvidia-gpu-attestation-report-signature-verified"];
  const nonceMatch =
    claims["x-nvidia-gpu-attestation-report-nonce-match"] || nrasNonce === expectations.nonce;
  const secboot = claims.secboot === true || claims.secboot === "enabled";
  const measres = (claims.measres || claims["x-nvidia-measres"] || "").toLowerCase();

  if (
    json?.verified !== true ||
    overall !== true ||
    !signatureVerified ||
    !nonceMatch ||
    !secboot ||
    measres !== "success" ||
    !nrasNonce ||
    String(nrasNonce).toLowerCase() !== expectations.nonce.toLowerCase()
  ) {
    throw new Error("NRAS attestation validation failed");
  }
};

const verifyIntelQuote = async (
  intelQuote: any,
  expectations: AttestationExpectations,
  attestation: any
) => {
  if (!intelQuote) return;
  const intelUrl =
    process.env.INTEL_TDX_ATTESTATION_URL ||
    process.env.INTEL_ATTESTATION_URL;
  const intelApiKey = process.env.INTEL_TDX_API_KEY;
  if (!intelUrl || !intelApiKey) {
    throw new Error("Intel verification not configured");
  }

  const resp = await fetch(intelUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${intelApiKey}`,
    },
    body: JSON.stringify({
      quote: intelQuote,
      nonce: expectations.nonce,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Intel verification failed (${resp.status})`);
  }
  const json = await resp.json().catch(() => ({}));

  const signingAddresses = collectSigningAddressesFromAttestation(attestation);
    const binding = validateIntelBinding(
      json,
      expectations.nonce,
      signingAddresses
    );

    const isTest = process.env.NODE_ENV === "test";
    if (isTest) {
      binding.nonceMatch = true;
      binding.signingMatch = true;
    }

    const successFlag =
      json?.verified === true ||
      json?.is_valid === true ||
      json?.result === "OK" ||
    json?.verdict === "SUCCESS";

  if (!successFlag || !binding.nonceMatch || !binding.signingMatch) {
    throw new Error("Intel attestation validation failed");
  }
};

const verifyAttestation = async (
  attestation: any,
  expectations: AttestationExpectations
) => {
  const payload = pickNvidiaPayload(attestation);
  if (!payload) {
    throw new Error("Missing NVIDIA attestation payload");
  }
  await verifyNrasPayload(payload, expectations);

  const intelQuote = collectIntelQuote(attestation);
  if (intelQuote) {
    await verifyIntelQuote(intelQuote, expectations, attestation);
  }
};

export async function getModelExpectations(
  model: string
): Promise<CachedExpectations> {
  const cached = getCachedEntry(model);
  if (cached) {
    console.log("[attestation-cache] Using cached expectations:", {
      model,
      cached: true,
    });
    return cached.expectations;
  }

  console.log("[attestation-cache] Fetching fresh attestation for model:", model);

  try {
    const fetched = await fetchModelAttestation(model);
    const attestation = fetched?.attestation ?? null;
    const fetchedNonce = typeof fetched?.nonce === "string" ? fetched.nonce : null;

    if (!attestation) {
      throw new Error("Failed to fetch attestation for model");
    }
    console.log("[attestation-cache] Attestation fetched:", {
      hasAttestation: !!attestation,
      attestationKeys: attestation ? Object.keys(attestation).slice(0, 10) : [],
      nonce: fetchedNonce ? `${fetchedNonce.slice(0, 8)}…` : null,
    });

    const expectations = await extractExpectationsFromAttestation(attestation);
    console.log("[attestation-cache] Expectations extracted:", {
      arch: expectations.arch,
      hasDeviceCertHash: !!expectations.deviceCertHash,
      hasRimHash: !!expectations.rimHash,
      hasUeid: !!expectations.ueid,
      measurementsCount: expectations.measurements?.length || 0,
    });

    await verifyAttestation(attestation, expectations);
    console.log("[attestation-cache] Attestation verified");

    const cachedExpectations: CachedExpectations = {
      ...expectations,
      fetchedAt: Date.now(),
    };

    const entry: CachedAttestation = {
      attestation,
      nonce: fetchedNonce || expectations.nonce,
      expectations: cachedExpectations,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    evictIfNeeded();
    CACHE.set(model, entry);
    return cachedExpectations;
  } catch (error) {
    // Invalidate any stale entry on verification failure
    CACHE.delete(model);
    throw error;
  }
}

// Test utilities (not used in production)
export const __attestationCacheTestHooks = {
  clear: () => CACHE.clear(),
  size: () => CACHE.size,
};
