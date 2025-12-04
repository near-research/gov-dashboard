import { describe, it, expect } from "vitest";
import { deriveVerificationState } from "@/utils/attestation/state";

const requestHash = "a".repeat(64);
const responseHash = "b".repeat(64);
const signatureText = `${requestHash}:${responseHash}`;
const validSignature =
  "0x2c6407c74f07f4a2a3f2e0b5b508a924e51ec4bf1326872fa3dfcde4a232f8d707ebdb5a0b8f359bd2d96ff47568cf8127781b78b810e16a3a836b6b5480a9a41b";
const recoveredAddress = "0x2016F58821aF58cbdfffdE6955dDb76F18f1b358";

describe("multi-node binding", () => {
  it("accepts signature from any attested node", () => {
    const signingAddresses = ["0xA1", "0xB2", "0xC3", recoveredAddress];
    const state = deriveVerificationState({
      proof: {
        attestation: {
          model_attestations: signingAddresses.map((addr) => ({
            signing_address: addr,
            nvidia_payload: JSON.stringify({ eat_nonce: "n" }),
          })),
        },
        nras: { verified: true },
        nonceCheck: { valid: true, expected: "n", attested: "n", nras: "n" },
      } as any,
      requestHash,
      responseHash,
      signatureText,
      signature: validSignature,
      signatureAddress: recoveredAddress,
      signatureAlgo: "ecdsa",
      attestationResult: "Pass",
      nrasVerified: true,
      trustedAddresses: signingAddresses,
    });
    expect(state.steps.address.status).toBe("success");
  });

  it("fails when signer not in trusted addresses", () => {
    const signingAddresses = ["0xA1", "0xB2"];
    const state = deriveVerificationState({
      proof: {
        attestation: {
          model_attestations: signingAddresses.map((addr) => ({
            signing_address: addr,
            nvidia_payload: JSON.stringify({ eat_nonce: "n" }),
          })),
        },
        nras: { verified: true },
        nonceCheck: { valid: true, expected: "n", attested: "n", nras: "n" },
      } as any,
      requestHash,
      responseHash,
      signatureText,
      signature: validSignature,
      signatureAddress: "0xFFFF",
      signatureAlgo: "ecdsa",
      attestationResult: "Pass",
      nrasVerified: true,
      trustedAddresses: signingAddresses,
    });
    expect(state.steps.address.status).toBe("error");
    expect(state.overall).toBe("failed");
  });
});
