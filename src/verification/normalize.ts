import type {
  VerificationMetadata,
  VerificationStatus,
} from "@/types/verification";

export const toVerificationStatus = (value?: string): VerificationStatus => {
  switch ((value || "").toLowerCase()) {
    case "verified":
    case "valid":
      return "verified";
    case "failed":
    case "invalid":
      return "failed";
    default:
      return "pending";
  }
};

export const shortenFingerprint = (value: string, visible = 6): string => {
  if (value.length <= visible * 2) return value;
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
};

export type NormalizedSignaturePayload = {
  signature?: string;
  text?: string;
  signing_address?: string;
  signing_algo?: string;
};

export const normalizeSignaturePayload = (
  sig: unknown
): NormalizedSignaturePayload | null => {
  if (!sig) return null;

  if (typeof sig === "string") {
    return { signature: sig };
  }

  if (typeof sig !== "object") {
    return null;
  }

  const candidateList = [
    sig,
    (sig as any)?.data,
    (sig as any)?.result,
    (sig as any)?.signature ? sig : null,
  ].filter(Boolean);

  for (const candidate of candidateList) {
    if (
      candidate &&
      (candidate.signature || candidate.text || candidate.signing_address)
    ) {
      return {
        signature: (candidate as any).signature,
        text: (candidate as any).text,
        signing_address: (candidate as any).signing_address,
        signing_algo: (candidate as any).signing_algo,
      };
    }
  }

  return null;
};

export const extractVerificationMetadata = (
  payload: Record<string, any>,
  envelope?: Record<string, any>
): VerificationMetadata | undefined => {
  if (!payload || typeof payload !== "object") return undefined;

  const hasMetadataFields =
    payload.verification ||
    payload.metadata ||
    payload.near_metadata ||
    envelope?.verification ||
    envelope?.metadata;

  if (typeof payload.id === "string" && !hasMetadataFields) {
    return {
      source: "near-ai-cloud",
      status: "pending",
      messageId: payload.id,
    };
  }

  const metadataSources = [
    payload.verification,
    payload.metadata?.verification,
    payload.near_metadata?.verification,
    envelope?.verification,
  ].filter(Boolean);

  const attestationSources = [
    payload.attestation,
    payload.metadata?.attestation,
    payload.near_metadata?.attestation,
    envelope?.attestation,
  ].filter(Boolean);

  const messageId =
    envelope?.message_id ||
    envelope?.id ||
    metadataSources[0]?.message_id ||
    payload.id;

  const proof =
    payload.proof ||
    payload.proof_blob ||
    payload.metadata?.proof ||
    payload.near_metadata?.proof ||
    envelope?.proof ||
    metadataSources[0]?.proof ||
    metadataSources[0]?.proof_blob;

  const signature =
    payload.signature ||
    payload.metadata?.signature ||
    payload.near_metadata?.signature ||
    metadataSources[0]?.signature ||
    envelope?.signature;

  const attestationReport =
    payload.attestation_report ||
    attestationSources[0]?.report ||
    attestationSources[0]?.evidence;

  const measurement =
    attestationSources[0]?.measurement ||
    metadataSources[0]?.measurement ||
    payload.measurement ||
    envelope?.measurement;

  const issuedAt =
    attestationSources[0]?.issued_at ||
    metadataSources[0]?.timestamp ||
    payload.timestamp;

  const status = toVerificationStatus(
    metadataSources[0]?.status ||
      payload.verification_status ||
      payload.status
  );

  if (
    !proof &&
    !signature &&
    !attestationReport &&
    !measurement &&
    !metadataSources.length &&
    !attestationSources.length
  ) {
    return undefined;
  }

  return {
    source: "near-ai-cloud",
    status,
    messageId,
    attestationReport,
    attestationUrl: attestationSources[0]?.url,
    proof,
    signature,
    measurement,
    issuedAt,
    error: metadataSources[0]?.error,
  };
};

export const normalizeVerificationPayload = (
  verification?: VerificationMetadata | null,
  fallbackId?: string | null
) => {
  const verificationId = fallbackId ?? verification?.messageId ?? null;

  let normalized = verification ?? undefined;

  if (!normalized && verificationId) {
    normalized = {
      source: "near-ai-cloud",
      status: "pending",
      messageId: verificationId,
    };
  } else if (normalized) {
    if (!normalized.messageId && verificationId) {
      normalized = { ...normalized, messageId: verificationId };
    }
  }

  return {
    verification: normalized,
    verificationId,
  };
};

export type { VerificationMetadata, VerificationStatus };
