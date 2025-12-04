import {
  normalizeVerificationPayload as baseNormalize,
  type VerificationMetadata,
} from "@/verification/normalize";
import { registerVerificationSession } from "./sessions";

export const normalizeVerificationPayload = (
  verification?: VerificationMetadata | null,
  fallbackId?: string | null
) => {
  const { verification: normalized, verificationId } = baseNormalize(
    verification,
    fallbackId
  );

  if (typeof window === "undefined" && verificationId) {
    try {
      const session = registerVerificationSession(verificationId);
      if (normalized && !normalized.nonce) {
        return {
          verification: { ...normalized, nonce: session.nonce },
          verificationId,
        };
      }
      return {
        verification: normalized,
        verificationId,
      };
    } catch (error) {
      console.error("Unable to register verification session:", error);
    }
  }

  return {
    verification: normalized,
    verificationId,
  };
};
