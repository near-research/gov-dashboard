import { extractHashesFromSignedText } from "@/verification/hash-utils";
import { normalizeSignaturePayload } from "@/verification/normalize";
import { decodeJwtPayload } from "@/utils/verification/shared";
import type {
  NrasVerificationResult,
  PartialExpectations,
  RemoteProof,
  VerificationAttestationPayload,
} from "@/types/verification";
import { detectAttestationType } from "@/utils/attestation/type-detection";

export { decodeJwtPayload } from "@/utils/verification/shared";

export const parseJsonPayload = (value: unknown) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    return value as Record<string, any>;
  }
  return null;
};

export const buildSignaturePayload = (signature?: RemoteProof["signature"]) =>
  normalizeSignaturePayload(signature);

export const resolveEffectiveHash = (
  attestedHash: string | undefined | null,
  proofHash?: string | null,
  fallback?: string
) => attestedHash || proofHash || fallback || null;

export const buildExpectationInput = (
  params: PartialExpectations,
  overrides?: Partial<PartialExpectations>
): PartialExpectations => ({
  ...params,
  ...(overrides ?? {}),
});

export const buildNrasSummary = (
  remoteProof: RemoteProof | null,
  nrasData: NrasVerificationResult | null
) => {
  const nras: NrasVerificationResult | null = remoteProof?.nras ?? nrasData;
  if (!nras) return null;

  return {
    verified: Boolean(nras.verified),
    jwt:
      typeof nras.token === "string"
        ? nras.token
        : typeof nras.jwt === "string"
        ? nras.jwt
        : null,
    claims: nras.claims,
    gpus: nras.gpus,
    raw: remoteProof?.nrasRaw ?? nras,
  };
};

export const resolveNvidiaPayloadForNras = (
  attestation: VerificationAttestationPayload | null | undefined
) => {
  if (!attestation || typeof attestation !== "object") return null;

  const attestationType = detectAttestationType(attestation);
  if (attestationType !== "nvidia") return null;

  const candidates = [
    attestation?.nvidia_payload,
    attestation?.gateway_attestation?.nvidia_payload,
    attestation?.model_attestations?.[0]?.nvidia_payload,
    attestation?.all_attestations?.[0]?.nvidia_payload,
  ].filter(Boolean);

  const candidate = candidates.find(Boolean);
  if (!candidate) return null;

  let parsed: any = candidate;
  if (typeof parsed === "string") {
    parsed = parseJsonPayload(parsed);
  }

  const payload = {
    nonce:
      parsed?.nonce ??
      parsed?.eat_nonce ??
      parsed?.["x-nvidia-eat-nonce"] ??
      null,
    arch: parsed?.arch ?? parsed?.gpu_arch ?? parsed?.["x-nvidia-arch"],
    evidence_list:
      parsed?.evidence_list ??
      parsed?.evidenceList ??
      parsed?.evidences ??
      null,
  };

  if (!payload.nonce || !payload.arch || !Array.isArray(payload.evidence_list)) {
    return null;
  }

  return payload;
};
