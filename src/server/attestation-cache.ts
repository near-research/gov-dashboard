import {
  fetchModelAttestation,
  extractExpectationsFromAttestation,
} from "@/utils/fetch-model-attestation";

type CachedExpectations = {
  arch: string;
  deviceCertHash: string;
  rimHash?: string | null;
  ueid?: string | null;
  measurements: string[];
  fetchedAt: number;
};

const CACHE = new Map<string, CachedExpectations>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getModelExpectations(
  model: string
): Promise<CachedExpectations> {
  const cached = CACHE.get(model);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    console.log("[attestation-cache] Using cached expectations:", {
      model,
      cached: true,
    });
    return cached;
  }

  console.log("[attestation-cache] Fetching fresh attestation for model:", model);

  const attestation = await fetchModelAttestation(model);
  console.log("[attestation-cache] Attestation fetched:", {
    hasAttestation: !!attestation,
    attestationKeys: attestation ? Object.keys(attestation).slice(0, 10) : [],
  });

  const expectations = await extractExpectationsFromAttestation(attestation);
  console.log("[attestation-cache] Expectations extracted:", {
    arch: expectations.arch,
    hasDeviceCertHash: !!expectations.deviceCertHash,
    hasRimHash: !!expectations.rimHash,
    hasUeid: !!expectations.ueid,
    measurementsCount: expectations.measurements?.length || 0,
  });

  const cachedExpectations: CachedExpectations = {
    ...expectations,
    fetchedAt: Date.now(),
  };

  CACHE.set(model, cachedExpectations);
  return cachedExpectations;
}
