import { createHash } from "crypto";

export interface IntelTdxVerificationResult {
  verified: boolean;
  reportDataValid: boolean;
  signingAddressBound: boolean;
  nonceBound: boolean;
  composeHashValid?: boolean;
  error?: string;
  reasons: string[];
}

const normalizeHexString = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/^0x/i, "").toLowerCase();
  return normalized || undefined;
};

const normalizeAddress = (value?: string | null): string | undefined => {
  const normalized = normalizeHexString(value);
  if (!normalized || normalized.length !== 40) return undefined;
  return `0x${normalized}`;
};

export const verifyTdxReportData = (
  reportData: string,
  expectedSigningAddress: string,
  expectedNonce: string
) => {
  const normalizedReport = normalizeHexString(reportData);
  if (!normalizedReport || normalizedReport.length < 128) {
    return {
      signingAddressBound: false,
      nonceBound: false,
    };
  }
  const signingAddressFromReport = `0x${normalizedReport.slice(0, 40)}`;
  const nonceFromReport = normalizedReport.slice(64, 128);
  return {
    signingAddressBound:
      signingAddressFromReport.toLowerCase() === expectedSigningAddress.toLowerCase(),
    nonceBound: nonceFromReport === normalizeHexString(expectedNonce),
  };
};

export const verifyComposeHash = (
  composeManifest: string,
  expectedHash: string
): boolean => {
  const hash = createHash("sha256").update(composeManifest).digest("hex");
  return hash === expectedHash.trim().toLowerCase();
};

export const verifyIntelTdxAttestation = async (
  attestation: any,
  expectedNonce?: string
): Promise<IntelTdxVerificationResult> => {
  const reasons: string[] = [];
  const gateway =
    attestation?.gateway_attestation ??
    attestation?.attestation?.gateway_attestation ??
    attestation?.attestation ??
    attestation;
  if (!gateway || typeof gateway !== "object") {
    const error = "Intel gateway attestation missing";
    reasons.push(error);
    return {
      verified: false,
      reportDataValid: false,
      signingAddressBound: false,
      nonceBound: false,
      error,
      reasons,
    };
  }

  const intelQuote = gateway?.intel_quote ?? gateway?.intelQuote;
  if (!intelQuote) {
    const error = "No Intel quote found";
    reasons.push("Missing intel_quote");
    return {
      verified: false,
      reportDataValid: false,
      signingAddressBound: false,
      nonceBound: false,
      error,
      reasons,
    };
  }

  const signingAddress =
    normalizeAddress(gateway?.signing_address ?? gateway?.signingAddress ?? null);
  const nonceForReport = normalizeHexString(
    expectedNonce ?? gateway?.request_nonce ?? gateway?.requestNonce
  );
  const reportDataRaw = gateway?.report_data ?? gateway?.reportData ?? "";
  const normalizedReportData = normalizeHexString(reportDataRaw);

  if (!signingAddress) {
    reasons.push("Missing signing_address");
  }
  if (!normalizedReportData) {
    reasons.push("Missing report_data");
  }
  if (!nonceForReport) {
    reasons.push("Missing nonce for binding verification");
  }

  let reportDataCheck = {
    signingAddressBound: false,
    nonceBound: false,
  };
  if (signingAddress && normalizedReportData && nonceForReport) {
    reportDataCheck = verifyTdxReportData(
      normalizedReportData,
      signingAddress,
      nonceForReport
    );
    if (!reportDataCheck.signingAddressBound) {
      reasons.push("Signing address not bound in report_data");
    }
    if (!reportDataCheck.nonceBound) {
      reasons.push("Nonce not bound in report_data");
    }
  }

  const info = gateway?.info ?? {};
  const composeManifest =
    info.compose_manifest ?? info.composeManifest ?? info.compose ?? null;
  const composeHash = info.compose_hash ?? info.composeHash ?? null;
  let composeHashValid: boolean | undefined;
  if (
    typeof composeManifest === "string" &&
    composeManifest.trim() &&
    typeof composeHash === "string" &&
    composeHash.trim()
  ) {
    composeHashValid = verifyComposeHash(composeManifest, composeHash);
    if (!composeHashValid) {
      reasons.push("Compose manifest hash mismatch");
    }
  }

  const reportDataValid =
    reportDataCheck.signingAddressBound && reportDataCheck.nonceBound;
  const verified =
    reportDataValid && (composeHashValid === undefined || composeHashValid);

  if (!verified && reasons.length === 0) {
    reasons.push("Intel TDX verification failed");
  }

  return {
    verified,
    reportDataValid,
    signingAddressBound: reportDataCheck.signingAddressBound,
    nonceBound: reportDataCheck.nonceBound,
    composeHashValid,
    reasons,
  };
};
