import { randomBytes } from "crypto";
import { servicesConfig } from "@/config/services";
import type { ModelAttestationResponse } from "@/types/verification";
import type { AttestationExpectations } from "./expectations";
import { extractHardwareExpectations } from "./hardware";

const DEFAULT_SIGNING_ALGO = "ecdsa";
const buildBaseUrl = () =>
  `${(servicesConfig as any)?.nearAI?.baseUrl || "https://cloud-api.near.ai"}/v1`;

export async function fetchModelAttestation(model?: string, signingAlgo = DEFAULT_SIGNING_ALGO) {
  if (!model) return null;

  const nonce = randomBytes(32).toString("hex");
  const baseUrl = buildBaseUrl();
  const url = `${baseUrl}/attestation/report?model=${encodeURIComponent(
    model
  )}&signing_algo=${encodeURIComponent(signingAlgo)}&nonce=${encodeURIComponent(nonce)}`;

  const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = (await res.json()) as ModelAttestationResponse | null;
  return { attestation: data, nonce, signingAlgo };
}

export async function extractExpectationsFromAttestation(
  attestation?: ModelAttestationResponse | null
): Promise<AttestationExpectations> {
  const expectations = extractHardwareExpectations(attestation);

  if (
    !expectations.nonce ||
    !expectations.arch ||
    !expectations.deviceCertHash ||
    !expectations.measurements?.length
  ) {
    throw new Error("Missing expected attestation fields from model attestation");
  }

  return {
    nonce: expectations.nonce,
    arch: expectations.arch,
    deviceCertHash: expectations.deviceCertHash,
    rimHash: expectations.rimHash,
    ueid: expectations.ueid,
    measurements: expectations.measurements,
  };
}
