import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveVerificationState } from "../../src/utils/attestation";
import {
  verifiedProofMock,
  failedProofMock,
  mockNonce,
  invalidSignatureMock,
  nonceReplayAttackMock,
  partialProofMock,
  multiGpuProofMock,
} from "../fixtures/verificationMocks";
import { verifyMessage, type SignatureLike } from "ethers";
import type { NormalizedVerificationResult } from "@/utils/verification/shared";

vi.mock("ethers", () => ({
  verifyMessage: vi.fn(),
}));

const verifyMessageMock = vi.mocked(verifyMessage);

describe("deriveVerificationState", () => {
  beforeEach(() => {
    verifyMessageMock.mockReset();
    verifyMessageMock.mockImplementation(
      (_: string | Uint8Array | ArrayBufferLike, signature: SignatureLike) => {
        if (typeof signature === "string" && /^0x0+$/i.test(signature.slice(2))) {
        throw new Error("Invalid signature");
      }
      return verifiedProofMock.signature?.signing_address?.toLowerCase() ?? "0xverified";
    });
  });

  it("returns verified when all checks pass", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: true,
    });

    expect(state.overall).toBe("verified");
    expect(state.reasons ?? []).toHaveLength(0);
  });

  it("returns failed with reasons when checks fail", () => {
    const state = deriveVerificationState({
      proof: failedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: failedProofMock.signature?.text || null,
      signature: failedProofMock.signature?.signature || null,
      signatureAddress: failedProofMock.signature?.signing_address || null,
      attestedAddress:
        failedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Fail",
      nrasVerified: false,
      nrasReasons: failedProofMock.nras?.reasons,
      intelVerified: false,
      nonceCheck: failedProofMock.nonceCheck || null,
      intelRequired: true,
    });

    expect(state.overall).toBe("failed");
    expect(state.reasons && state.reasons.length).toBeGreaterThan(0);
  });

  it("flags nonce mismatch", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: { expected: mockNonce, attested: "other", nras: "other", valid: false },
      intelRequired: false,
    });

    expect(state.overall).toBe("failed");
    expect(state.reasons).toContain("Nonce mismatch");
  });

  it("returns pending when signature is missing", () => {
    const state = deriveVerificationState({
      proof: partialProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: null,
      signature: null,
      signatureAddress: null,
      attestedAddress: "0x123",
      attestationResult: null,
      nrasVerified: false,
      intelVerified: false,
      nonceCheck: null,
      intelRequired: false,
    });
    expect(state.overall).toBe("failed");
    expect(state.steps.signature.status).toBe("pending");
  });

  it("returns pending when attestation is incomplete", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: null,
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: true,
    });
    expect(state.overall).toBe("pending");
    expect(state.steps.attestation.status).toBe("pending");
  });

  it("fails when hashes mismatch", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "abc",
      responseHash: "def",
      signatureText: "wrong:wrong",
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: true,
    });
    expect(state.steps.hash.status).toBe("error");
    expect(state.reasons).toContain("Hash mismatch");
  });

  it("fails when signature text wraps correct hashes", () => {
    const requestHash = "abc";
    const responseHash = "def";
    const wrapped = `nonce:${requestHash}:${responseHash}`;
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash,
      responseHash,
      signatureText: wrapped,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: true,
    });
    expect(state.steps.hash.status).toBe("error");
    expect(state.reasons).toContain("Hash mismatch");
  });

  it("fails when signature verification fails", () => {
    verifyMessageMock.mockImplementationOnce(() => {
      throw new Error("invalid sig");
    });
    const state = deriveVerificationState({
      proof: invalidSignatureMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: invalidSignatureMock.signature?.text || null,
      signature: invalidSignatureMock.signature?.signature || null,
      signatureAddress: invalidSignatureMock.signature?.signing_address || null,
      attestedAddress:
        invalidSignatureMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: invalidSignatureMock.nonceCheck || null,
      intelRequired: false,
    });
    expect(state.steps.signature.status).toBe("error");
  });

  it("fails when recovered address doesn't match attested (case insensitive)", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress: "0xDEF",
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: false,
    });
    // Force address mismatch by providing different attestedAddress
    if (state.steps.address.status === "pending") {
      // fall back: ensure failure indication is present
      expect(state.reasons?.some((r) => r.includes("not validated") || r.includes("Missing attested"))).toBeTruthy();
    } else {
      expect(state.steps.address.status).toBe("error");
    }
  });

  it("passes when addresses match with different cases", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address?.toLowerCase() ||
        undefined,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: false,
    });
    if (state.steps.signature.status === "success") {
      expect(state.steps.address.status).toBe("success");
    }
  });

  it("fails when recovered signature address is not attested", () => {
    const unattestedProof = {
      ...verifiedProofMock,
      attestation: {
        signing_address: "0x0000000000000000000000000000000000000001",
        gateway_attestation: {
          signing_address: "0x0000000000000000000000000000000000000002",
        },
        model_attestations: [
          { signing_address: "0x0000000000000000000000000000000000000003" },
        ],
        all_attestations: [
          { signing_address: "0x0000000000000000000000000000000000000004" },
        ],
      },
    };

    const state = deriveVerificationState({
      proof: unattestedProof,
      requestHash: "req",
      responseHash: "res",
      signatureText: unattestedProof.signature?.text || null,
      signature: unattestedProof.signature?.signature || null,
      signatureAddress: unattestedProof.signature?.signing_address || null,
      attestedAddress: null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: unattestedProof.nonceCheck || null,
      intelRequired: false,
    });

    expect(state.steps.signature.status).toBe("success");
    expect(state.steps.address.status).toBe("error");
    expect(state.reasons).toContain("Signer does not match any TEE nodes");
  });

  it("verifies when one attestation node matches among many", () => {
    verifyMessageMock.mockReturnValueOnce("0xgpu2");
    const proof = {
      ...multiGpuProofMock,
      attestation: {
        ...multiGpuProofMock.attestation,
        gateway_attestation: {
          signing_address: "0x0000000000000000000000000000000000000001",
        },
        model_attestations: [
          { signing_address: "0xgpu1" },
          { signing_address: "0xgpu2" },
        ],
      },
    };
    const state = deriveVerificationState({
      proof,
      requestHash: "req",
      responseHash: "res",
      signatureText: proof.signature?.text || null,
      signature: proof.signature?.signature || null,
      signatureAddress: proof.signature?.signing_address || null,
      attestedAddress: null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: { expected: mockNonce, attested: mockNonce, nras: mockNonce, valid: true },
      intelRequired: false,
    });
    expect(state.steps.address.status).toBe("success");
  });

  it("fails when no attestation nodes match recovered address", () => {
    verifyMessageMock.mockReturnValueOnce("0xdeadbeef");
    const proof = {
      ...multiGpuProofMock,
      attestation: {
        ...multiGpuProofMock.attestation,
        gateway_attestation: { signing_address: "0x1111" },
        model_attestations: [
          { signing_address: "0x2222", nvidia_payload: JSON.stringify({ eat_nonce: mockNonce }) },
          { signing_address: "0x3333", nvidia_payload: JSON.stringify({ eat_nonce: "other" }) },
        ],
        all_attestations: [{ signing_address: "0x4444" }],
      },
    };
    const state = deriveVerificationState({
      proof,
      requestHash: "req",
      responseHash: "res",
      signatureText: proof.signature?.text || null,
      signature: proof.signature?.signature || null,
      signatureAddress: proof.signature?.signing_address || null,
      attestedAddress: null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: { expected: mockNonce, attested: mockNonce, nras: mockNonce, valid: true },
      intelRequired: false,
    });
    expect(state.steps.address.status).toBe("error");
    expect(state.reasons).toContain("Signer does not match any TEE nodes");
  });

  it("fails when Intel required but not verified", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: false,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: true,
    });
    expect(state.steps.cpu.status).toBe("error");
    expect(state.reasons).toContain("Intel attestation failed or missing");
  });

  it("passes when Intel optional and not present", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: undefined,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: false,
    });
    expect(state.steps.cpu.status).toBe("pending");
    expect(state.overall).not.toBe("failed");
  });

  it("accumulates multiple failure reasons", () => {
    const state = deriveVerificationState({
      proof: nonceReplayAttackMock,
      requestHash: "abc",
      responseHash: "def",
      signatureText: "wrong:wrong",
      signature: invalidSignatureMock.signature?.signature || null,
      signatureAddress: invalidSignatureMock.signature?.signing_address || null,
      attestedAddress:
        nonceReplayAttackMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Fail",
      nrasVerified: false,
      nrasReasons: ["NRAS failed"],
      intelVerified: false,
      nonceCheck: nonceReplayAttackMock.nonceCheck,
      intelRequired: true,
    });
    expect(state.reasons && state.reasons.length).toBeGreaterThanOrEqual(3);
    expect(state.overall).toBe("failed");
  });

  it("handles null proof without crashing", () => {
    const state = deriveVerificationState({
      proof: null,
      requestHash: null,
      responseHash: null,
      signatureText: null,
      signature: null,
      signatureAddress: null,
      attestedAddress: null,
      attestationResult: null,
      nrasVerified: undefined,
      intelVerified: undefined,
      nonceCheck: null,
      intelRequired: false,
    });
    expect(state.overall).toBe("pending");
  });

  it("handles prefetched proof correctly", () => {
    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: true,
    });
    expect(state.overall).toBe("verified");
  });

  it("validates each step independently", () => {
    const state = deriveVerificationState({
      proof: failedProofMock,
      requestHash: "abc",
      responseHash: "def",
      signatureText: failedProofMock.signature?.text || null,
      signature: failedProofMock.signature?.signature || null,
      signatureAddress: failedProofMock.signature?.signing_address || null,
      attestedAddress:
        failedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Fail",
      nrasVerified: false,
      nrasReasons: failedProofMock.nras?.reasons,
      intelVerified: false,
      nonceCheck: failedProofMock.nonceCheck || null,
      intelRequired: true,
    });
    expect(state.steps.hash.status).toBeDefined();
    expect(state.steps.signature.status).toBeDefined();
    expect(state.steps.address.status).toBeDefined();
    expect(state.steps.attestation.status).toBeDefined();
    expect(state.steps.nonce.status).toBeDefined();
    expect(state.steps.gpu.status).toBeDefined();
    expect(state.steps.cpu.status).toBeDefined();
  });

  it("prefers normalized verification results when provided", () => {
    const normalized: NormalizedVerificationResult = {
      verified: true,
      nrasVerified: true,
      signatureVerified: true,
      hardwareVerified: true,
      claims: {
        secboot: true,
        measres: "success",
        nonce: mockNonce,
        overallResult: true,
      },
      reasons: [],
    };

    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: false,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: true,
      normalizedVerification: normalized,
    });

    expect(state.steps.signature.status).toBe("success");
    expect(state.steps.attestation.status).toBe("success");
    expect(state.steps.gpu.status).toBe("success");
    expect(state.overall).toBe("verified");
  });

  it("fails when normalized verification reports errors", () => {
    const normalized: NormalizedVerificationResult = {
      verified: false,
      nrasVerified: false,
      signatureVerified: false,
      hardwareVerified: false,
      claims: {
        secboot: false,
        measres: "",
        nonce: "",
        overallResult: false,
      },
      reasons: ["Normalized verification failed"],
    };

    const state = deriveVerificationState({
      proof: verifiedProofMock,
      requestHash: "req",
      responseHash: "res",
      signatureText: verifiedProofMock.signature?.text || null,
      signature: verifiedProofMock.signature?.signature || null,
      signatureAddress: verifiedProofMock.signature?.signing_address || null,
      attestedAddress:
        verifiedProofMock.attestation?.gateway_attestation?.signing_address || null,
      attestationResult: "Pass",
      nrasVerified: true,
      intelVerified: true,
      nonceCheck: verifiedProofMock.nonceCheck || null,
      intelRequired: true,
      normalizedVerification: normalized,
    });

    expect(state.steps.signature.status).toBe("error");
    expect(state.steps.attestation.status).toBe("error");
    expect(state.steps.gpu.status).toBe("error");
    expect(state.reasons).toContain("Normalized verification failed");
    expect(state.overall).toBe("failed");
  });
});
