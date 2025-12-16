import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/near-ai/verification/attestation", () => ({
  fetchAttestation: vi.fn(),
}));

vi.mock("@/lib/near-ai/verification/signature", () => ({
  fetchSignature: vi.fn(),
  compareHashes: vi.fn(),
  verifySignature: vi.fn(),
}));

import { verifyChatMessage } from "@/lib/near-ai";
import { fetchAttestation } from "@/lib/near-ai/verification/attestation";
import {
  fetchSignature,
  compareHashes,
  verifySignature,
} from "@/lib/near-ai/verification/signature";
import type {
  HashValidation,
  SignatureValidation,
} from "@/lib/near-ai/verification/types";

const REQUEST_BODY = "{\"messages\":[]}";
const STREAMED_RESPONSE = 'data: {"id":"chat-1"}\n';

const createHashValidation = (overrides?: Partial<HashValidation>): HashValidation =>
  Object.assign(
    {
      valid: true,
      requestHashMatch: true,
      responseHashMatch: true,
      signedRequestHash: "req",
      signedResponseHash: "res",
      computedRequestHash: "req",
      computedResponseHash: "res",
    },
    overrides
  );

const createSignatureValidation = (
  overrides?: Partial<SignatureValidation>
): SignatureValidation =>
  Object.assign(
    {
      valid: true,
      recoveredAddress: "0x1234",
      signingAddress: "0x1234",
      teeAddresses: ["0x1234"],
      teeAttested: true,
    },
    overrides
  );

const fetchAttestationMock = vi.mocked(fetchAttestation);
const fetchSignatureMock = vi.mocked(fetchSignature);
const compareHashesMock = vi.mocked(compareHashes);
const verifySignatureMock = vi.mocked(verifySignature);

beforeEach(() => {
  vi.clearAllMocks();

  fetchAttestationMock.mockResolvedValue({
    teeAddresses: ["0x1234"],
    hasNvidiaPayload: false,
    nvidiaPayloads: [],
    report: {},
    raw: {},
  });

  fetchSignatureMock.mockResolvedValue({
    text: "req:res",
    signature: "0xsig",
    signing_address: "0x1234",
    signing_algo: "ecdsa",
  });

  compareHashesMock.mockReturnValue(createHashValidation());
  verifySignatureMock.mockReturnValue(createSignatureValidation());
});

describe("NEAR AI verification edge cases", () => {
  it("detects hash mismatch and fails", async () => {
    compareHashesMock.mockReturnValue(
      createHashValidation({
        valid: false,
        requestHashMatch: false,
        responseHashMatch: false,
        computedRequestHash: "req",
        computedResponseHash: "res",
        signedRequestHash: "wrong",
        signedResponseHash: "wrong",
      })
    );

    const result = await verifyChatMessage(
      REQUEST_BODY,
      STREAMED_RESPONSE,
      "model"
    );

    expect(result.verified).toBe(false);
    expect(result.error).toEqual(expect.stringContaining("hash"));
  });

  it("rejects a signer not present in TEE attestation", async () => {
    verifySignatureMock.mockReturnValue(
      createSignatureValidation({
        valid: true,
        recoveredAddress: "0xWRONG",
        signingAddress: "0xWRONG",
        teeAddresses: ["0x1234"],
        teeAttested: false,
      })
    );

    const result = await verifyChatMessage(
      REQUEST_BODY,
      STREAMED_RESPONSE,
      "model"
    );

    expect(result.verified).toBe(true);
    expect(result.warnings).toContain(
      "Signer not in current attestation list (gateway rotation)"
    );
    expect(result.error).toBeUndefined();
  });

  it("fails when the attestation fetch errors", async () => {
    fetchAttestationMock.mockRejectedValue(new Error("Network error"));

    const result = await verifyChatMessage(
      REQUEST_BODY,
      STREAMED_RESPONSE,
      "model"
    );

    expect(result.verified).toBe(false);
    expect(result.error).toEqual(
      expect.stringContaining("Attestation")
    );
  });

  it("fails when fetching the signature fails", async () => {
    fetchSignatureMock.mockRejectedValue(new Error("signature fetch failed"));

    const result = await verifyChatMessage(
      REQUEST_BODY,
      STREAMED_RESPONSE,
      "model"
    );

    expect(result.verified).toBe(false);
    expect(result.error).toEqual(
      expect.stringContaining("signature")
    );
  });
});
