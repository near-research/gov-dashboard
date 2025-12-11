import type {
  VerificationProofResponse,
  VerificationResult,
} from "@/types/verification";

export const normalizeHashValue = (value?: string | null) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.length) return "";
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
};

export const decodeJwtPayload = (token?: string | null) => {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;

  const decodeBase64 = (value: string) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof atob === "function") {
      return atob(normalized);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(normalized, "base64").toString("utf8");
    }
    throw new Error("No base64 decoder available");
  };

  try {
    const payload = decodeBase64(parts[1]);
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

type VerifyResult = VerificationResult | VerificationProofResponse;

const BOOLEAN_TRUE_VALUES = ["1", "true", "enabled"];

const isTrueLike = (value: unknown) => {
  if (value === true) return true;
  if (typeof value === "string") {
    return BOOLEAN_TRUE_VALUES.includes(value.toLowerCase());
  }
  return false;
};

const ensureString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

export interface NormalizedVerificationResult {
  verified: boolean;
  nrasVerified: boolean;
  signatureVerified: boolean;
  hardwareVerified: boolean;
  claims: {
    secboot: boolean;
    measres: string;
    nonce: string;
    overallResult: boolean;
  };
  reasons: string[];
}

const extractNormalizedClaims = (
  claims: Record<string, unknown> | null | undefined
) => ({
  secboot:
    claims === null || claims === undefined
      ? false
      : isTrueLike(claims.secboot ?? claims["x-nvidia-secboot"]),
  measres: ensureString(claims?.measres ?? claims?.["x-nvidia-measres"]),
  nonce: ensureString(
    claims?.eat_nonce ??
      claims?.["x-nvidia-eat-nonce"] ??
      claims?.nonce ??
      claims?.["x-nvidia-claim-nonce"]
  ),
  overallResult: Boolean(
    claims?.["x-nvidia-overall-att-result"] ||
      claims?.overall_result ||
      claims?.overall_pass
  ),
});

const resolveNormalizedResult = (raw: VerifyResult): NormalizedVerificationResult => {
  const existing = (raw as VerificationProofResponse & {
    normalized?: NormalizedVerificationResult | null;
  }).normalized;
  if (existing) {
    return existing;
  }

  const nras = raw.nras ?? null;
  const signatureVerification = (raw as VerificationResult).signatureVerification;
  const proofResponse = raw as VerificationProofResponse;
  const claims = extractNormalizedClaims(nras?.claims ?? null);
  const reasons = [
    ...(raw.reasons ?? []),
    ...(nras?.reasons ?? []),
    ...(signatureVerification?.reason ? [signatureVerification.reason] : []),
  ];

  return {
    verified: Boolean(raw.verified),
    nrasVerified: Boolean(nras?.verified),
    signatureVerified: Boolean(signatureVerification?.verified),
    hardwareVerified:
      Boolean(nras?.verified) ||
      Boolean(proofResponse.results?.verified) ||
      Boolean(raw.verified),
    claims,
    reasons,
  };
};

export const normalizeVerificationResult = (
  raw?: VerifyResult | null
): NormalizedVerificationResult | null => {
  if (!raw) return null;
  return resolveNormalizedResult(raw);
};
