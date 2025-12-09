import "../../vi-compat";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VerificationProofResponse } from "@/types/verification";
import { renderHook, waitFor } from "@testing-library/react";
import { useVerificationProof } from "@/components/verification/useVerificationProof";
import {
  proofPayload,
  mockNonce,
  mockAddress,
  verifiedProofMock,
} from "../../fixtures/verification";
import { officialNearAIExample } from "../../fixtures/verificationMocks";
import { toast } from "sonner";
import { verifyMessage } from "ethers";

const fetchVerificationProofMock = vi.fn();
const verifyWithNrasServiceMock = vi.fn();
const mockRecoveredAddress = mockAddress;

vi.mock("@/services/verification/proof-service", () => ({
  fetchVerificationProof: (...args: unknown[]) => fetchVerificationProofMock(...args),
  verifyWithNrasService: (...args: unknown[]) => verifyWithNrasServiceMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("ethers", () => ({
  verifyMessage: vi.fn(() => mockRecoveredAddress),
}));

const verifyMessageMock = vi.mocked(verifyMessage);

const renderHookWithParams = (props: Parameters<typeof useVerificationProof>[0]) =>
  renderHook(() => useVerificationProof(props));

describe("useVerificationProof hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchVerificationProofMock.mockReset();
    verifyWithNrasServiceMock.mockReset();
    verifyMessageMock.mockReset();
    verifyMessageMock.mockReturnValue(mockRecoveredAddress);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches proof with attestation and signature and derives verified state", async () => {
    fetchVerificationProofMock.mockResolvedValueOnce(proofPayload as VerificationProofResponse);
    const { result } = renderHookWithParams({
      open: true,
      autoFetch: true,
      verificationId: "ver-123",
      model: "m",
      requestHash: "reqhash",
      responseHash: "reshash",
      nonce: "nonce123",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "device-cert",
      expectedRimHash: "rim-hash",
      expectedUeid: "ueid-1",
      expectedMeasurements: ["m1"],
    });

    await waitFor(() => expect(fetchVerificationProofMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(result.current.remoteProof?.signature?.signature).toBe(
        proofPayload.signature.signature
      )
    );
    expect(result.current.derivedStatus).toBe("verified");
    expect(result.current.attestationPayload?.signingAddress).toBe(mockAddress);
  });

  it("surfaces NRAS verification errors while keeping existing proof data", async () => {
    const prefetchedProof: VerificationProofResponse = {
      ...verifiedProofMock,
      attestation: {
        ...verifiedProofMock.attestation,
        gateway_attestation: {
          ...(verifiedProofMock.attestation as any)?.gateway_attestation,
          nvidia_payload: JSON.stringify({
            eat_nonce: mockNonce,
            arch: "HOPPER",
            evidence_list: [],
          }),
        },
      },
    };

    verifyWithNrasServiceMock.mockRejectedValueOnce(new Error("NRAS unavailable"));
    const { result } = renderHookWithParams({
      open: true,
      verificationId: "ver-456",
      requestHash: "req",
      responseHash: "res",
      nonce: mockNonce,
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "device-cert",
      expectedRimHash: "rim-hash",
      expectedMeasurements: ["m1"],
      prefetchedProof,
    });

    await waitFor(() => expect(result.current.remoteProof).toBeTruthy());
    expect(result.current.nvidiaPayloadForNras).toBeTruthy();

    await waitFor(async () => {
      await result.current.verifyWithNRAS();
      expect(verifyWithNrasServiceMock).toHaveBeenCalledWith({
        verificationId: "ver-456",
        payload: expect.objectContaining({ nonce: mockNonce }),
      });
    });
    expect(result.current.nrasError).toBe("NRAS unavailable");
    expect(result.current.nrasData).toBeNull();
    expect((toast as any).error).toHaveBeenCalledWith("NRAS unavailable");
  });

  it("detects hash mismatch when attested hashes differ from recorded values", async () => {
    const mismatchedRequestHash = "a".repeat(64);
    const mismatchedResponseHash = "b".repeat(64);
    const prefetchedProof: VerificationProofResponse = {
      ...verifiedProofMock,
      signature: {
        text: officialNearAIExample.text,
        signature: officialNearAIExample.signature,
        signing_address: officialNearAIExample.signingAddress,
        signing_algo: "ecdsa",
      },
      sessionRequestHash: mismatchedRequestHash,
      sessionResponseHash: mismatchedResponseHash,
      requestHash: mismatchedRequestHash,
      responseHash: mismatchedResponseHash,
    };

    const { result } = renderHookWithParams({
      open: true,
      verificationId: "ver-789",
      requestHash: "c".repeat(64),
      responseHash: "d".repeat(64),
      nonce: mockNonce,
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "device-cert",
      expectedRimHash: "rim-hash",
      expectedMeasurements: ["m1"],
      prefetchedProof,
    });

    await waitFor(() => expect(result.current.attestedHashes).toBeTruthy());
    expect(result.current.attestedHashes).toEqual({
      requestHash: officialNearAIExample.requestHash,
      responseHash: officialNearAIExample.responseHash,
    });
    expect(result.current.hashMismatch).toBe(true);
  });

  it("verifies signatures locally with verifyMessage and flags address mismatch", async () => {
    const { result, rerender } = renderHookWithParams({
      open: true,
      prefetchedProof: {
        ...verifiedProofMock,
        signature: {
          ...verifiedProofMock.signature,
          text: `${"a".repeat(64)}:${"b".repeat(64)}`,
        },
      } as any,
      requestHash: "a".repeat(64),
      responseHash: "b".repeat(64),
    });

    await waitFor(() => expect(result.current.independentVerification).toBeTruthy());
      expect(result.current.independentVerification?.checks?.address).toBe(true);

    verifyMessageMock.mockReturnValueOnce("0xdead");
    rerender({
      open: true,
      prefetchedProof: {
        ...verifiedProofMock,
        signature: {
          ...verifiedProofMock.signature,
          text: `${"a".repeat(64)}:${"b".repeat(64)}`,
        },
      } as any,
      requestHash: "a".repeat(64),
      responseHash: "b".repeat(64),
    });

    await waitFor(
      () =>
        result.current.independentVerification?.checks &&
        result.current.independentVerification.checks.address === false
    );
  });
});
