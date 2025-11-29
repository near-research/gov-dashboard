import type { AttestationExpectations } from "@/utils/attestation-expectations";

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
  for (const key of keys) {
    const v = obj?.[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

const extractFromEvidence = (evidenceList: any[] | undefined) => {
  if (!Array.isArray(evidenceList)) return {};

  const out: Partial<AttestationExpectations> = {};
  const measurements: string[] = [];

  for (const item of evidenceList) {
    if (!item || typeof item !== "object") continue;
    out.deviceCertHash ??= getFirst(item, ["device_cert_hash", "cert_hash", "deviceCertHash"]);
    out.rimHash ??= getFirst(item, ["rim", "rim_hash", "rimHash", "driver_rim_hash", "vbios_rim_hash"]);
    out.ueid ??= getFirst(item, ["ueid", "device_id"]);

    if (Array.isArray(item.measurements)) {
      for (const m of item.measurements) {
        if (typeof m === "string") measurements.push(m);
        else if (m?.hash) measurements.push(String(m.hash));
      }
    }
  }

  if (measurements.length) out.measurements = measurements;
  return out;
};

const buildExpectations = (payload: any): AttestationExpectations => {
  const evidenceList = payload?.evidence_list ?? payload?.evidenceList ?? payload?.evidences;

  const base: Partial<AttestationExpectations> = {
    nonce:
      payload?.nonce ??
      payload?.eat_nonce ??
      payload?.["x-nvidia-eat-nonce"],
    arch:
      payload?.arch ??
      payload?.gpu_arch ??
      payload?.["x-nvidia-arch"] ??
      payload?.["x-nvidia-gpu-arch"],
    deviceCertHash: payload?.device_cert_hash,
    rimHash: payload?.rim,
    ueid: payload?.ueid,
  };

  const fromEvidence = extractFromEvidence(evidenceList);

  const expectations: AttestationExpectations = {
    nonce: String(base.nonce ?? fromEvidence.nonce ?? ""),
    arch: String(base.arch ?? fromEvidence.arch ?? ""),
    deviceCertHash: String(base.deviceCertHash ?? fromEvidence.deviceCertHash ?? ""),
    rimHash: (base.rimHash ?? fromEvidence.rimHash)?.toString(),
    ueid: (base.ueid ?? fromEvidence.ueid)?.toString(),
    measurements: (fromEvidence.measurements ?? []).map((m) => String(m)),
  };

  const requiredMissing: string[] = [];
  if (!expectations.nonce.trim()) requiredMissing.push("nonce");
  if (!expectations.arch.trim()) requiredMissing.push("arch");
  if (!expectations.deviceCertHash.trim()) requiredMissing.push("deviceCertHash");
  if (!expectations.measurements.length) requiredMissing.push("measurements");

  if (requiredMissing.length) {
    throw new Error(
      `Missing expected attestation fields: ${requiredMissing.join(", ")}`
    );
  }

  return expectations;
};

export const clearHardwareExpectationsCache = () => cache.clear();

export async function fetchHardwareExpectations(model: string): Promise<AttestationExpectations> {
  const existing = cache.get(model);
  if (existing && existing.expiresAt > now()) {
    return existing.value;
  }

  const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;
  if (!apiKey) {
    throw new Error("NEAR_AI_CLOUD_API_KEY not configured");
  }

  const res = await fetch(
    `https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(model)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch attestation report (${res.status}): ${text || "Unknown error"}`);
  }

  const attestation = await res.json();

  const candidates: any[] = [];
  if (Array.isArray(attestation?.model_attestations)) {
    for (const m of attestation.model_attestations) {
      if (m?.nvidia_payload) candidates.push(m.nvidia_payload);
    }
  }
  if (attestation?.nvidia_payload) candidates.push(attestation.nvidia_payload);
  if (attestation?.gateway_attestation?.nvidia_payload) {
    candidates.push(attestation.gateway_attestation.nvidia_payload);
  }

  const payload = candidates
    .map((raw) => parseJsonSafe(raw))
    .find((p) => p && p.evidence_list);

  if (!payload) {
    throw new Error("No NVIDIA payload with evidence_list found in attestation report");
  }

  const expectations = buildExpectations(payload);
  cache.set(model, { value: expectations, expiresAt: now() + CACHE_TTL_MS });
  return expectations;
}
