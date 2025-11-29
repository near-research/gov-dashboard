import type { VerificationMetadata } from "@/types/agui-events";
import type { VerificationProofResponse } from "@/types/verification";

export const mergeVerificationStatusFromProof = (
  verification: VerificationMetadata | null | undefined,
  proof: VerificationProofResponse | null | undefined
): VerificationMetadata | undefined => {
  if (!proof?.results) return verification ?? undefined;

  const status: VerificationMetadata["status"] =
    proof.results.verified === true
      ? "verified"
      : proof.results.verified === false &&
        (proof.results.reasons?.length || 0) > 0
      ? "failed"
      : "pending";
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
