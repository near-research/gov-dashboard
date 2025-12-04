import type { RemoteProof } from "@/components/verification/VerificationProof";
import { extractHashesFromSignedText } from "@/verification/hash-utils";
import { normalizeSignaturePayload } from "@/verification/normalize";
import { decodeJwtPayload } from "@/utils/verification/shared";
import type { PartialExpectations } from "@/utils/attestation/expectations";
import type { NrasResult } from "@/types/verification";

export { decodeJwtPayload } from "@/utils/verification/shared";

export const verifyNRASJWT = (
  jwt?: string | null,
  expectedNonce?: string | null
) => {
  if (!jwt || typeof jwt !== "string") return false;
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return false;

    const header = JSON.parse(
      atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"))
    );
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    );

    if (!header || !payload) return false;
    if (payload.iss !== "https://nras.attestation.nvidia.com") return false;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return false;
    if (payload.nbf && payload.nbf > now) return false;
    if (payload["x-nvidia-overall-att-result"] !== true) return false;
    if (expectedNonce) {
      const tokenNonce =
        payload.eat_nonce ||
        payload["x-nvidia-eat-nonce"] ||
        payload.nonce ||
        null;
      if (
        !tokenNonce ||
        tokenNonce.toString().toLowerCase() !== expectedNonce.toLowerCase()
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
};

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

export const buildAttestedHashes = (signatureText?: string | null) =>
  extractHashesFromSignedText(signatureText);

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

export const buildAttestationPayload = (att?: RemoteProof["attestation"]) => {
  if (!att) return null;
  const gateway = att.gateway_attestation ?? att;
  const modelAttestations = Array.isArray(att.model_attestations)
    ? att.model_attestations.filter(Boolean)
    : [];
  return {
    modelAttestation: modelAttestations[0] || null,
    modelAttestations,
    signingAddress:
      gateway.signing_address || gateway.signingAddress || gateway.key,
    signingAlgo:
      gateway.signing_algo ||
      gateway.signing_algorithm ||
      gateway.algorithm ||
      undefined,
    reportData: gateway.report_data || gateway.reportData,
    requestNonce: gateway.request_nonce || gateway.requestNonce,
    raw: gateway,
  };
};

export const buildAttestationSummary = ({
  remoteProof,
  nrasData,
}: {
  remoteProof: RemoteProof | null;
  nrasData: NrasResult | null;
}) => {
  const nras = remoteProof?.nras || nrasData;

  const decodeLocalJwt = (token?: string | null) => decodeJwtPayload(token);

  const nrasClaims = (() => {
    if (nras?.claims) return nras.claims;
    if (nras?.gpus && typeof nras.gpus === "object") {
      const firstGpuToken = Object.values(nras.gpus)[0] as string | undefined;
      if (firstGpuToken) {
        return decodeLocalJwt(firstGpuToken);
      }
    }
    return null;
  })();

  if (!remoteProof && !nrasClaims) return null;
  if (!remoteProof?.attestation && !nrasClaims) return null;

  try {
    const att = remoteProof?.attestation ?? {};
    const modelAttestations = Array.isArray(att.model_attestations)
      ? att.model_attestations.filter(Boolean)
      : [];
    const primaryModelAttestation = modelAttestations[0] || null;
    const nvidiaPayload =
      primaryModelAttestation?.nvidia_payload ||
      att.nvidia_payload ||
      att.gateway_attestation?.nvidia_payload;
    const intelPayload =
      att.intel_quote ||
      att.gateway_attestation?.intel_quote ||
      primaryModelAttestation?.intel_quote;

    const nvidia = parseJsonPayload(nvidiaPayload);
    const intel = parseJsonPayload(intelPayload);
    const claims = nrasClaims || {};

    const secbootRaw = nvidia?.secboot ?? nvidia?.["x-nvidia-secboot"];
    const dbgstatRaw = nvidia?.dbgstat ?? nvidia?.["x-nvidia-dbgstat"];
    const attResult =
      (remoteProof?.nras || nrasData) && nrasClaims
        ? nrasClaims?.["x-nvidia-overall-att-result"] ??
          nrasClaims?.overall_result ??
          nrasClaims?.overall_pass
        : undefined;

    const hardwareFromVerifiedClaims = Boolean(
      remoteProof?.nras?.verified || nrasData?.verified
    );

    const nonceBound = remoteProof?.nonceCheck?.valid === true;

    const intelConfigured =
      !remoteProof?.configMissing?.intel &&
      !remoteProof?.configMissing?.intelApiKey;
    const intelQuotePresent = Boolean(
      intelPayload ||
        att.gateway_attestation?.intel_quote ||
        att.model_attestations?.[0]?.intel_quote
    );

    const gpuValidated = hardwareFromVerifiedClaims && nonceBound;

    const hardwareValidated =
      gpuValidated &&
      (intelQuotePresent && intelConfigured
        ? remoteProof?.intel?.verified === true
        : true);

    const safeValue = (value: any) => {
      if ((hardwareValidated || gpuValidated) && value) return value;
      return "Not available";
    };

    const backendAttestationResult =
      (remoteProof?.results as any)?.verified === true
        ? "Pass"
        : (remoteProof?.results as any)?.verified === false
        ? "Fail"
        : null;

    return {
      gpu: safeValue(
        claims?.hwmodel ||
          claims?.["x-nvidia-gpu-driver-version"] ||
          nvidia?.["x-nvidia-gpu-driver-version"] ||
          nvidia?.hwmodel ||
          intel?.hwmodel
      ),
      driver: safeValue(
        claims?.["x-nvidia-gpu-driver-version"] ||
          nvidia?.["x-nvidia-gpu-driver-version"]
      ),
      vbios: safeValue(
        claims?.["x-nvidia-gpu-vbios-version"] ||
          nvidia?.["x-nvidia-gpu-vbios-version"]
      ),
      nonce: hardwareFromVerifiedClaims
        ? claims?.eat_nonce ||
          claims?.["x-nvidia-eat-nonce"] ||
          nvidia?.eat_nonce ||
          intel?.eat_nonce ||
          ""
        : "",
      oem: safeValue(claims?.oemid || intel?.oemid || nvidia?.oemid),
      secboot: hardwareFromVerifiedClaims
        ? claims?.secboot === true || claims?.secboot === "enabled"
          ? "Enabled"
          : claims?.secboot === false || claims?.secboot === "disabled"
          ? "Disabled"
          : "Unverified"
        : "Unverified",
      dbgstat: safeValue(
        claims?.dbgstat || claims?.["x-nvidia-dbgstat"] || dbgstatRaw
      ),
      attestationResult:
        backendAttestationResult ||
        (attResult === false
          ? "Fail"
          : hardwareValidated
          ? "Pass"
          : "Unverified"),
      hasHardwareDetails:
        (gpuValidated || hardwareValidated) &&
        Boolean(
          claims?.hwmodel ||
            claims?.["x-nvidia-gpu-driver-version"] ||
            claims?.["x-nvidia-gpu-vbios-version"] ||
            nvidia?.hwmodel ||
            nvidia?.["x-nvidia-gpu-driver-version"] ||
            nvidia?.["x-nvidia-gpu-vbios-version"]
        ),
      verifiedHardware: hardwareValidated,
      hardwareReason:
        !hardwareValidated && hardwareFromVerifiedClaims
          ? remoteProof?.nras?.reasons?.join?.("\n") ||
            (remoteProof?.intel && remoteProof.intel.verified === false
              ? "Intel verification failed"
              : "Hardware attestation incomplete")
          : !hardwareFromVerifiedClaims
          ? "NRAS verification missing"
          : undefined,
      gpuVerified: gpuValidated,
      intelConfigured,
      fullVerification: hardwareValidated,
    };
  } catch (error) {
    console.error("Failed to parse attestation summary:", error);
    return null;
  }
};

export const buildNrasSummary = (
  remoteProof: RemoteProof | null,
  nrasData: NrasResult | null
) => {
  const nras: NrasResult | null = remoteProof?.nras ?? nrasData;
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
  attestationPayload: ReturnType<typeof buildAttestationPayload>
) => {
  const att =
    attestationPayload?.modelAttestation ||
    attestationPayload?.modelAttestations?.[0] ||
    attestationPayload?.raw;
  if (!att) return null;

  const candidate =
    att?.nvidia_payload ||
    att?.model_attestations?.[0]?.nvidia_payload ||
    att?.gateway_attestation?.nvidia_payload ||
    null;

  if (!candidate) return null;

  let parsed: any = candidate;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
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
