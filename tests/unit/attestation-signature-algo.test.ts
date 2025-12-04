import { describe, it, expect } from "vitest";
import { deriveVerificationState } from "@/utils/attestation/state";

describe("deriveVerificationState signing algorithm", () => {
  const requestHash = "a".repeat(64);
  const responseHash = "b".repeat(64);
  const signatureText = `${requestHash}:${responseHash}`;
  const validSignature =
    "0x2c6407c74f07f4a2a3f2e0b5b508a924e51ec4bf1326872fa3dfcde4a232f8d707ebdb5a0b8f359bd2d96ff47568cf8127781b78b810e16a3a836b6b5480a9a41b";
  const signingAddress = "0x18E0d350C8a9a753d7D529ac9Ba090436E261C3b";

  it("fails when signing algorithm is unsupported", () => {
    const state = deriveVerificationState({
      requestHash,
      responseHash,
      signatureText,
      signature: validSignature,
      signatureAddress: signingAddress,
      signatureAlgo: "ed25519",
      attestedAddress: signingAddress,
      nonceCheck: { valid: true, expected: "n".repeat(64), attested: "n".repeat(64), nras: "n".repeat(64) },
      attestationResult: "Pass",
      nrasVerified: true,
    });
    expect(state.steps.signature.status).toBe("error");
    expect(state.overall).toBe("failed");
  });

  it("accepts ed25519 signing when address is provided", () => {
    const state = deriveVerificationState({
      requestHash,
      responseHash,
      signatureText,
      signature: "ed25519-signature",
      signatureAddress: "ed25519:abc",
      signatureAlgo: "ed25519",
      attestedAddress: "ed25519:abc",
      nonceCheck: { valid: true, expected: "n".repeat(64), attested: "n".repeat(64), nras: "n".repeat(64) },
      attestationResult: "Pass",
      nrasVerified: true,
      trustedAddresses: ["ed25519:abc"],
    });
    expect(state.steps.signature.status).toBe("success");
    expect(state.steps.address.status).toBe("success");
  });

  it("requires recovered address to match signing_address", () => {
    const state = deriveVerificationState({
      requestHash,
      responseHash,
      signatureText,
      signature: validSignature,
      signatureAddress: "0xdead",
      signatureAlgo: "ecdsa",
      attestedAddress: signingAddress,
      nonceCheck: { valid: true, expected: "n".repeat(64), attested: "n".repeat(64), nras: "n".repeat(64) },
      attestationResult: "Pass",
      nrasVerified: true,
    });
    expect(state.steps.signature.status).toBe("success"); // cryptographically valid
    expect(state.steps.address.status).toBe("error"); // but wrong signer
    expect(state.overall).toBe("failed");
  });
});
