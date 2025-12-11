export type AttestationType = "nvidia" | "intel" | "unknown";

const hasIntelQuote = (obj: Record<string, unknown>): boolean => {
  if (obj.intel_quote || obj.intelQuote) return true;
  if (obj.gateway_attestation && typeof obj.gateway_attestation === "object") {
    const gateway = obj.gateway_attestation as Record<string, unknown>;
    if (gateway.intel_quote) return true;
  }
  if (Array.isArray(obj.model_attestations)) {
    if (obj.model_attestations.some((n: any) => n?.intel_quote)) return true;
  }
  return false;
};

const hasNvidiaPayload = (obj: Record<string, unknown>): boolean => {
  if (obj.nvidia_payload || obj.nvidiaPayload) return true;
  if (obj.gateway_attestation && typeof obj.gateway_attestation === "object") {
    const gateway = obj.gateway_attestation as Record<string, unknown>;
    if (gateway.nvidia_payload) return true;
  }
  if (Array.isArray(obj.model_attestations)) {
    if (obj.model_attestations.some((n: any) => n?.nvidia_payload)) return true;
  }
  return false;
};

/**
 * Detect attestation type from a full attestation response.
 * Works with snake_case keys from API responses (gateway_attestation, model_attestations, etc.)
 */
export const detectAttestationType = (attestation: unknown): AttestationType => {
  if (!attestation || typeof attestation !== "object") return "unknown";

  const record = attestation as Record<string, unknown>;
  if (hasIntelQuote(record)) return "intel";
  if (hasNvidiaPayload(record)) return "nvidia";
  return "unknown";
};

/**
 * Detect attestation type from a node summary object.
 * Works with camelCase keys from AttestationNodeSummary (nvidiaPayload, intelQuote)
 */
export const detectNodeType = (node: {
  nvidiaPayload?: unknown;
  intelQuote?: unknown;
}): AttestationType => {
  if (node.nvidiaPayload) return "nvidia";
  if (node.intelQuote) return "intel";
  return "unknown";
};
