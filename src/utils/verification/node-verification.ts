import { verificationConfig } from "@/config/verification";
import {
  collectSigningAddressesFromAttestation,
  validateIntelBinding,
} from "@/utils/verification/intel";
import { AttestationNodeSummary } from "@/types/verification";
import type { AttestationExpectations } from "@/utils/attestation/expectations";
import type {
  IntelVerificationResult,
  NrasResult,
} from "@/types/verification";

const parseJsonSafe = (value: unknown): Record<string, any> | null => {
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

export async function verifyNodeWithNras(
  node: AttestationNodeSummary,
  expectations: AttestationExpectations | null
): Promise<NrasResult> {
  if (!node.nvidiaPayload) {
    return {
      verified: false,
      reasons: ["missing NVIDIA payload"],
    };
  }

  const payload = parseJsonSafe(node.nvidiaPayload) || {};
  const body = {
    nonce:
      payload?.nonce ||
      payload?.eat_nonce ||
      payload?.["x-nvidia-eat-nonce"] ||
      expectations?.nonce,
    arch: payload?.arch || payload?.gpu_arch || expectations?.arch,
    evidence_list:
      payload?.evidence_list || payload?.evidenceList || payload?.evidences || [],
    device_cert_hash:
      payload?.device_cert_hash || expectations?.deviceCertHash,
    rim: payload?.rim || payload?.rim_hash || expectations?.rimHash,
    ueid: payload?.ueid || expectations?.ueid,
  };

  const result: NrasResult = {
    verified: false,
    raw: null,
    reasons: [],
    claims: null,
  };

  try {
    const resp = await fetch(verificationConfig.nras.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      result.verified = false;
      result.reasons?.push(`NRAS HTTP ${resp.status}`);
      return result;
    }

    const json = await resp.json();
    result.raw = json;
    result.claims = json?.claims ?? null;
    result.jwt = json?.jwt ?? null;
    result.token = json?.token ?? null;
    result.gpus = json?.gpus ?? null;

    const claims = (result.claims ?? {}) as Record<string, any>;
    const nrasNonce =
      claims.eat_nonce ||
      claims.nonce ||
      claims["x-nvidia-eat-nonce"] ||
      json?.nonce;
    const overall = claims["x-nvidia-overall-att-result"];
    const signatureVerified =
      claims["x-nvidia-gpu-attestation-report-signature-verified"];
    const nonceMatch =
      claims["x-nvidia-gpu-attestation-report-nonce-match"] ||
      (typeof nrasNonce === "string" &&
        expectations?.nonce &&
        nrasNonce.toLowerCase() === expectations.nonce.toLowerCase());
    const secboot =
      claims.secboot === true ||
      claims.secboot === "enabled" ||
      claims.secboot === "on";
    const measres = (claims.measres || claims["x-nvidia-measres"] || "")
      .toString()
      .toLowerCase();

    const success =
      json?.verified === true ||
      overall === true ||
      (signatureVerified && nonceMatch && secboot && measres === "success");

    result.verified = success;
    if (!success) {
      result.reasons?.push("NRAS verification flags missing");
    }
  } catch (error) {
    result.reasons?.push(
      `NRAS request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}

export async function verifyNodeWithIntel(
  node: AttestationNodeSummary,
  expectations: AttestationExpectations | null,
  attestation: any
): Promise<IntelVerificationResult> {
  const intelQuote = node.intelQuote;
  const result: IntelVerificationResult = {
    verified: false,
    raw: null,
  };

  if (!intelQuote) {
    result.error = "Missing Intel quote";
    return result;
  }

  const intelUrl =
    process.env.INTEL_TDX_ATTESTATION_URL ||
    process.env.INTEL_ATTESTATION_URL;
  const intelApiKey = process.env.INTEL_TDX_API_KEY;
  if (!intelUrl || !intelApiKey) {
    result.error = "Intel verification not configured";
    return result;
  }

  try {
    const resp = await fetch(intelUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${intelApiKey}`,
      },
      body: JSON.stringify({
        quote: intelQuote,
        nonce: expectations?.nonce,
      }),
    });

    if (!resp.ok) {
      result.error = `Intel verification HTTP ${resp.status}`;
      return result;
    }

    const json = await resp.json().catch(() => ({}));
    result.raw = json;

    const signingAddresses = collectSigningAddressesFromAttestation(attestation);
    const binding = validateIntelBinding(
      json,
      expectations?.nonce,
      signingAddresses
    );

    const verified =
      json?.verified === true ||
      json?.is_valid === true ||
      json?.result === "OK" ||
      binding.nonceMatch;

    result.verified = verified;
    if (!verified) {
      result.error = "Intel binding failed";
      result.reasons = [
        `nonceMatch:${binding.nonceMatch}`,
        `signingMatch:${binding.signingMatch}`,
      ];
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}
