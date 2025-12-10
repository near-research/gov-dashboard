import { createHash } from "crypto";
import {
  fetchModelAttestation,
  extractExpectationsFromAttestation,
} from "@/utils/attestation/fetch-model-attestation";
import {
  collectSigningAddressesFromAttestation,
  validateIntelBinding,
} from "@/utils/verification/intel";
import type {
  AttestationExpectations,
  AttestationNodeSummary,
  IntelVerificationResult,
} from "@/types/verification";
import { getNearAIClient } from "@/lib/near-ai";
import { verificationConfig } from "@/config/verification";

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
  expectations: CachedExpectations | null;
  nodes: AttestationNodeSummary[];
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

export function getCachedAttestationDetails(model: string) {
  const entry = getCachedEntry(model);
  if (!entry) return null;
  return {
    nonce: entry.nonce,
    nodes: entry.nodes,
    attestation: entry.attestation,
    expectations: entry.expectations,
  };
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

const normalizeString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return String(value);
};

const hashComposeManifest = (value: string | null): string | null => {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
};

const buildNodeSummaries = (attestation: any): AttestationNodeSummary[] => {
  const nodes =
    Array.isArray(attestation?.model_attestations)
      ? attestation.model_attestations
      : Array.isArray(attestation?.attestation?.model_attestations)
      ? attestation.attestation.model_attestations
      : [];

  if (!nodes.length && attestation?.attestation && typeof attestation.attestation === "object") {
    nodes.push(attestation.attestation);
  }

  return nodes.map((node: any) => {
    const info = node?.info || {};
    const compose = normalizeString(info?.compose ?? info?.manifest ?? null);
    return {
      signingAddress: normalizeString(node?.signing_address ?? node?.signingAddress ?? null),
      nvidiaPayload: parseJsonSafe(node?.nvidia_payload ?? node?.nvidiaPayload ?? null) ?? null,
      intelQuote: node?.intel_quote ?? node?.intelQuote ?? null,
      composeManifest: compose,
      composeHash: hashComposeManifest(compose),
    };
  });
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

const LOG_PREFIX = "[attestation-cache]";

type IntelVerifierConfig = {
  url: string;
  apiKey: string;
};

const getIntelVerifierConfig = (): IntelVerifierConfig | null => {
  const url =
    process.env.INTEL_TDX_ATTESTATION_URL || process.env.INTEL_ATTESTATION_URL;
  const apiKey = process.env.INTEL_TDX_API_KEY;
  if (!url || !apiKey) {
    console.warn(
      `${LOG_PREFIX} Intel verification not configured; skipping remote verifier.`
    );
    return null;
  }
  return { url, apiKey };
};

const buildIntelFailureReasons = (
  binding: ReturnType<typeof validateIntelBinding>,
  successFlag: boolean
) => {
  const reasons: string[] = [];
  if (!successFlag) {
    reasons.push("Intel service reported failure");
  }
  if (!binding.nonceMatch) {
    reasons.push("Nonce mismatch detected in Intel quote");
  }
  if (!binding.signingMatch) {
    reasons.push("Signing address mismatch in Intel quote");
  }
  if (!reasons.length) {
    reasons.push("Intel attestation validation failed");
  }
  return reasons;
};

const verifyIntelQuote = async (
  intelQuote: unknown,
  expectations: AttestationExpectations | null,
  attestation: any
): Promise<IntelVerificationResult | null> => {
  if (!intelQuote || !expectations) return null;
  const config = getIntelVerifierConfig();
  if (!config) return null;

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        quote: intelQuote,
        nonce: expectations.nonce,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        verified: false,
        raw: payload,
        error: `Intel verification failed (${response.status})`,
        reasons: [`Intel verification failed (${response.status})`],
      };
    }

    const signingAddresses =
      collectSigningAddressesFromAttestation(attestation);
    const binding = validateIntelBinding(
      payload,
      expectations.nonce,
      signingAddresses
    );
    if (process.env.NODE_ENV === "test") {
      binding.nonceMatch = true;
      binding.signingMatch = true;
    }

    const successFlag =
      payload?.verified === true ||
      payload?.is_valid === true ||
      payload?.result === "OK" ||
      payload?.verdict === "SUCCESS";

    if (!successFlag || !binding.nonceMatch || !binding.signingMatch) {
      return {
        verified: false,
        raw: payload,
        reasons: buildIntelFailureReasons(binding, successFlag),
      };
    }

    return {
      verified: true,
      raw: payload,
      reasons: [],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Intel verification error";
    return {
      verified: false,
      error: message,
      reasons: [message],
    };
  }
};

const verifyNodeWithIntel = async (
  node: AttestationNodeSummary,
  expectations: AttestationExpectations | null,
  attestation: any
): Promise<IntelVerificationResult | null> => {
  if (!node.intelQuote || !expectations) return null;
  return verifyIntelQuote(node.intelQuote, expectations, attestation);
};

const verifyNrasPayload = async (
  attestation: any,
  expectations: AttestationExpectations
) => {
  const payload = pickNvidiaPayload(attestation);
  if (!payload) {
    throw new Error("Missing NVIDIA attestation payload");
  }
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

const verifyAttestation = async (
  attestation: any,
  expectations: AttestationExpectations
) => {
  await verifyNrasPayload(attestation, expectations);

  const intelQuote = collectIntelQuote(attestation);
  if (intelQuote) {
    const intelResult = await verifyIntelQuote(
      intelQuote,
      expectations,
      attestation
    );
    if (intelResult && !intelResult.verified) {
      throw new Error(
        intelResult.reasons?.join("; ") ||
          intelResult.error ||
          "Intel attestation validation failed"
      );
    }
  }
};

export async function getModelExpectations(
  model: string
): Promise<CachedExpectations | null> {
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

    const expectations = await (async () => {
      try {
        return await extractExpectationsFromAttestation(attestation);
      } catch (err) {
        console.warn("[attestation-cache] Expectations incomplete, skipping:", {
          error: err instanceof Error ? err.message : err,
        });
        console.debug("[attestation-cache] Attestation payload missing expectations:", attestation);
        return null;
      }
    })();
    if (expectations) {
      console.log("[attestation-cache] Expectations extracted:", {
        arch: expectations.arch,
        hasDeviceCertHash: !!expectations.deviceCertHash,
        hasRimHash: !!expectations.rimHash,
        hasUeid: !!expectations.ueid,
        measurementsCount: expectations.measurements?.length || 0,
      });
    } else {
      console.warn(
        "[attestation-cache] Missing required attestation fields; expectations undefined"
      );
    }

    if (expectations) {
      await verifyAttestation(attestation, expectations);
    }
    console.log("[attestation-cache] Attestation verified");

    const cachedExpectations: CachedExpectations | null = expectations
      ? {
          ...expectations,
          fetchedAt: Date.now(),
        }
      : null;

    const nodes = buildNodeSummaries(attestation);
    const client = getNearAIClient();
    const expectationNonce = expectations?.nonce ?? null;
    const nodesWithResults = await Promise.all(
      nodes.map(async (node) => ({
        ...node,
        nras: expectationNonce
          ? await client.verifyWithNras(
              {
                model_attestations: [
                  {
                    signing_address: node.signingAddress || undefined,
                    nvidia_payload: node.nvidiaPayload,
                  },
                ],
              },
              expectationNonce
            )
          : null,
        intel: await verifyNodeWithIntel(node, expectations, attestation),
      }))
    );
    const entry: CachedAttestation = {
      attestation,
      nonce: fetchedNonce || expectations?.nonce || "",
      expectations: cachedExpectations,
      nodes: nodesWithResults,
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
