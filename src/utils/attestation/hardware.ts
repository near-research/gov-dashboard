import { servicesConfig } from "@/config/services";
import type { AttestationExpectations } from "@/types/verification";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CacheEntry = { expiresAt: number; value: AttestationExpectations };
const cache = new Map<string, CacheEntry>();

const now = () => Date.now();

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

const getFirst = (obj: any, keys: string[]) => {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

const normalizeMeasurements = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : typeof v?.hash === "string" ? v.hash : null))
      .filter((v): v is string => !!v);
  }
  if (typeof value === "string") return [value];
  if (typeof value?.hash === "string") return [value.hash];
  return [];
};

const gatherSections = (payload: any) => {
  const sections: any[] = [];
  const pushSection = (value: any) => {
    const parsed = parseJsonSafe(value);
    const entry = parsed ?? value;
    if (!entry) return;
    if (Array.isArray(entry)) {
      entry.forEach((item) => pushSection(item));
      return;
    }
    if (typeof entry === "object") {
      sections.push(entry);
      pushSection(entry?.nvidia_payload);
      pushSection(entry?.info);
    }
  };

  pushSection(payload);
  pushSection(payload?.attestation);
  pushSection(payload?.attestation?.gateway_attestation);
  pushSection(payload?.attestation?.nvidia_payload);
  pushSection(payload?.gateway_attestation);
  pushSection(payload?.gateway_attestation?.nvidia_payload);
  pushSection(payload?.model_attestations);
  pushSection(payload?.all_attestations);
  return sections;
};

const pickFromSections = (sections: any[], keys: string[]) => {
  for (const section of sections) {
    const value = getFirst(section, keys);
    if (value !== undefined) return value;
  }
  return undefined;
};

const parseExpectationsPayload = (payload: any): Partial<AttestationExpectations> => {
  const sections = gatherSections(payload);

  const expectations: Partial<AttestationExpectations> = {
    nonce: pickFromSections(sections, [
      "nonce",
      "eat_nonce",
      "x-nvidia-eat-nonce",
      "expectedNonce",
      "request_nonce",
    ]),
    arch: pickFromSections(sections, ["arch", "gpu_arch", "expectedArch", "expected_arch"]),
    deviceCertHash: pickFromSections(sections, [
      "deviceCertHash",
      "device_cert_hash",
      "expectedDeviceCertHash",
      "expected_device_cert_hash",
    ]),
    rimHash: pickFromSections(sections, ["rimHash", "rim", "expectedRimHash", "expected_rim_hash"]),
    ueid: pickFromSections(sections, ["ueid", "expectedUeid", "expected_ueid", "device_id"]),
    measurements: normalizeMeasurements(
      pickFromSections(sections, ["measurements", "expectedMeasurements", "expected_measurements"])
    ),
  };

  const evidenceList =
    sections
      .flatMap((section) => {
        const list =
          section?.attestation?.evidence ||
          section?.attestation?.all_attestations ||
          section?.evidence_list ||
          section?.evidence;
        return Array.isArray(list) ? list : [];
      }) ?? [];
  if (Array.isArray(evidenceList)) {
    evidenceList.forEach((item: any) => {
      expectations.deviceCertHash ??= getFirst(item, [
        "device_cert_hash",
        "cert_hash",
        "deviceCertHash",
      ]);
      expectations.rimHash ??= getFirst(item, [
        "rim",
        "rim_hash",
        "rimHash",
        "driver_rim_hash",
        "vbios_rim_hash",
      ]);
      expectations.ueid ??= getFirst(item, ["ueid", "device_id", "device_id_hex"]);
      const meas = normalizeMeasurements(
        getFirst(item, ["measurements", "measurement", "expected_measurements"])
      );
      if (meas.length) {
        expectations.measurements ??= [];
        expectations.measurements.push(...meas);
      }
    });
  }

  return expectations;
};

const buildUrl = (model: string) =>
  `${(servicesConfig as any)?.nearAI?.baseUrl || "https://cloud-api.near.ai"}/model/attestation/${encodeURIComponent(
    model
  )}`;

export const clearHardwareExpectationsCache = () => cache.clear();

const getCachedByModel = (model: string): AttestationExpectations | null => {
  const prefix = `${model}:`;
  for (const [key, entry] of cache.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (entry.expiresAt > now()) {
      return entry.value;
    }
    cache.delete(key);
  }
  return null;
};

export const fetchHardwareExpectations = async (
  model: string
): Promise<AttestationExpectations> => {
  const cached = getCachedByModel(model);
  if (cached) return cached;

  const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(buildUrl(model), { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch hardware expectations for ${model} (${res.status})`);
  }

  const json = await res.json();
  const payload = json?.nvidia_payload ?? json?.payload ?? json;
  const expectations = parseExpectationsPayload(payload);

  if (
    !expectations.nonce ||
    !expectations.arch ||
    !expectations.deviceCertHash ||
    !expectations.measurements?.length
  ) {
    throw new Error("Missing expected hardware attestation fields");
  }

  const result: AttestationExpectations = {
    nonce: expectations.nonce,
    arch: expectations.arch,
    deviceCertHash: expectations.deviceCertHash,
    rimHash: expectations.rimHash,
    ueid: expectations.ueid,
    measurements: expectations.measurements,
  };

  const cacheKey = `${model}:${result.nonce}`;
  cache.set(cacheKey, { value: result, expiresAt: now() + CACHE_TTL_MS });
  return result;
};

export const getCachedHardwareExpectations = (
  key: string
): AttestationExpectations | null => {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > now()) {
    return entry.value;
  }
  cache.delete(key);
  return null;
};

export const setCachedHardwareExpectations = (
  key: string,
  value: AttestationExpectations
) => {
  cache.set(key, { value, expiresAt: now() + CACHE_TTL_MS });
};

export const extractHardwareExpectations = (
  proof: any
): Partial<AttestationExpectations> => {
  if (!proof || typeof proof !== "object") return {};
  return parseExpectationsPayload(proof);
};

export const mergeHardwareExpectations = (
  base: Partial<AttestationExpectations>,
  overrides: Partial<AttestationExpectations>
): AttestationExpectations => {
  return {
    nonce: overrides.nonce || base.nonce || "",
    arch: overrides.arch || base.arch || "",
    deviceCertHash: overrides.deviceCertHash || base.deviceCertHash || "",
    rimHash: overrides.rimHash || base.rimHash,
    ueid: overrides.ueid || base.ueid,
    measurements: overrides.measurements || base.measurements || [],
  };
};
