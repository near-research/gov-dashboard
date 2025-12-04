import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deriveVerificationState } from "@/utils/attestation";
import { verifyMessage } from "ethers";

vi.mock("ethers", () => ({
  verifyMessage: vi.fn(),
}));

const verifyMessageMock = vi.mocked(verifyMessage);
describe("deriveVerificationState nonce handling", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    verifyMessageMock.mockReset();
    vi.restoreAllMocks();
  });

  it("marks nonce missing as error and overall failed", () => {
    const state = deriveVerificationState({
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: null,
    });
    expect(state.steps.nonce.status).toBe("error");
    expect(state.steps.nonce.message).toMatch(/missing nonce check/i);
    expect(state.overall).toBe("failed");
  });

  it("marks nonce mismatch as error", () => {
    const state = deriveVerificationState({
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: { expected: "a", attested: "b", nras: "c", valid: false },
    });
    expect(state.steps.nonce.status).toBe("error");
    expect(state.reasons).toContain("Nonce mismatch");
    expect(state.overall).toBe("failed");
  });

  it("marks nonce bound as success when valid", () => {
    const state = deriveVerificationState({
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: { expected: "a", attested: "a", nras: "a", valid: true },
    });
    expect(state.steps.nonce.status).toBe("success");
    expect(state.steps.attestation.status).toBe("success");
  });

  it("treats attested address comparison as case-insensitive", () => {
    verifyMessageMock.mockReturnValue("0xAbC");

    const state = deriveVerificationState({
      signature: "0xdeadbeef",
      signatureText: "text",
      attestedAddress: "0xAbC",
      signatureAddress: "0xabc",
      proof: {
        attestation: {
          signing_address: "0xabc",
        },
      } as any,
    });
    expect(state.steps.address.status).toBe("success");
  });

  it("surfaces address mismatch reason when provided attested address differs", () => {
    verifyMessageMock.mockReturnValue("0x222");

    const state = deriveVerificationState({
      signature: "0xsignature",
      signatureText: "hello",
      attestedAddress: "0x111",
      signatureAddress: "0x222",
      proof: {
        attestation: {
          signing_address: "0x222",
        },
      } as any,
    });
    expect(state.steps.address.status).toBe("error");
    expect(state.reasons).toContain("Signer does not match attested key");
  });
});
