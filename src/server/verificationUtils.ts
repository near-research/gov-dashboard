import type { VerificationMetadata } from "@/types/agui-events";
import type { VerificationProofResponse } from "@/types/verification";

export const mergeVerificationStatusFromProof = (
  verification: VerificationMetadata | null | undefined,
  proof: VerificationProofResponse | null | undefined
): VerificationMetadata | undefined => {
  const normalized = proof?.normalized;
  if (!normalized && !proof?.results) {
    return verification ?? undefined;
  }

  const normalizedFailed =
    normalized?.verified === false ||
    (normalized?.reasons?.length ?? 0) > 0;
  const normalizedStatus: VerificationMetadata["status"] | undefined =
    normalized?.verified === true
      ? "verified"
      : normalizedFailed
      ? "failed"
      : undefined;

  const resultsStatus: VerificationMetadata["status"] | undefined = proof?.results
    ? proof.results.verified === true
      ? "verified"
      : proof.results.verified === false &&
        (proof.results.reasons?.length || 0) > 0
      ? "failed"
      : "pending"
    : undefined;

  const status =
    normalizedStatus ??
    resultsStatus ??
    verification?.status ??
    "pending";
  const base: VerificationMetadata =
    verification ??
    ({
      source: "near-ai-cloud",
      status: "pending",
    } as VerificationMetadata);

  if (base.status === status) {
    return base;
  }

  return {
    ...base,
    status,
  };
};
