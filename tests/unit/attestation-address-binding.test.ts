import { describe, it, expect } from "vitest";
import { deriveVerificationState } from "@/utils/attestation/state";

const requestHash = "a".repeat(64);
const responseHash = "b".repeat(64);
const signatureText = `${requestHash}:${responseHash}`;
const validSignature =
  "0x2c6407c74f07f4a2a3f2e0b5b508a924e51ec4bf1326872fa3dfcde4a232f8d707ebdb5a0b8f359bd2d96ff47568cf8127781b78b810e16a3a836b6b5480a9a41b";
const signingAddress = "0x18E0d350C8a9a753d7D529ac9Ba090436E261C3b";

describe("address binding", () => {
  it("fails when signature signing_address does not match attested", () => {
    const proof = {
      attestation: {
        gateway_attestation: {
          signing_address: signingAddress,
        },
      },
      signature: {
        signing_address: "0x0000000000000000000000000000000000000000",
        signing_algo: "ecdsa",
      },
      nras: { verified: true },
      nonceCheck: { valid: true, expected: "n".repeat(64), attested: "n".repeat(64), nras: "n".repeat(64) },
    } as any;

    const state = deriveVerificationState({
      proof,
      requestHash,
      responseHash,
      signatureText,
      signature: validSignature,
      signatureAddress: proof.signature.signing_address,
      signatureAlgo: "ecdsa",
      attestedAddress: signingAddress,
      attestationResult: "Pass",
      nrasVerified: true,
      nonceCheck: proof.nonceCheck,
    });
    expect(state.steps.address.status).toBe("error");
    expect(state.overall).toBe("failed");
  });
});
