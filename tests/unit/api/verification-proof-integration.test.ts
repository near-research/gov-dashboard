import "../../vi-compat";
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import handler from "@/pages/api/verification/proof";
import type { NextApiRequest, NextApiResponse } from "next";
import { verifiedProofMock } from "../../fixtures/verification";
import {
  registerVerificationSession,
  clearVerificationSession,
} from "@/verification/server";

var sessionNonce = "a".repeat(64);
var attestedAddress = "0x856039d8a60613528d1dbec3dc920f5fe96a31a0";

vi.mock("@/server/screening", () => ({
  verifyNearAuth: vi.fn().mockResolvedValue({ result: { accountId: "test.near" } }),
}));
vi.mock("dcap-qvl", () => ({
  verifyQuote: vi.fn().mockResolvedValue({
    valid: true,
    reportData: `nonce=${sessionNonce};signer=${attestedAddress}`,
    measurements: ["m1"],
    mr_config: "db669af634b75c7f298400f3b6c2aa8ba54998bac83e23d10ab4eaadc4b50ccf",
  }),
}));
vi.mock("@/utils/verification/intel", () => ({
  validateIntelBinding: vi.fn(() => ({
    nonceMatch: true,
    signingMatch: true,
    reportDataString: "",
    nonceFound: sessionNonce,
    signingFound: attestedAddress,
  })),
  collectSigningAddressesFromAttestation: vi.fn(() => [attestedAddress]),
}));

function mockReqRes(body: any) {
  const req = {
    method: "POST",
    body,
    headers: { host: "localhost:3000", authorization: "Bearer test" } as Record<string, any>,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
  const state = { status: 200, body: undefined as any, headers: {} as Record<string, any> };
  const res = {
    setHeader(key: string, value: any) {
      state.headers[key] = value;
      return this;
    },
    status(code: number) {
      state.status = code;
      return this;
    },
    json(payload: any) {
      state.body = payload;
      return this;
    },
  } as unknown as NextApiResponse;
  return { req, res, state };
}

describe("verification/proof end-to-end chain (integration, mocked fetch)", () => {
  const originalEnv = {
    nodeEnv: process.env.NODE_ENV,
    intelUrl: process.env.INTEL_TDX_ATTESTATION_URL,
    intelKey: process.env.INTEL_TDX_API_KEY,
    nearKey: process.env.NEAR_AI_CLOUD_API_KEY,
  };

  beforeAll(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERIFY_USE_MOCKS", "false");
    vi.stubEnv("NEAR_AI_CLOUD_API_KEY", "mock-key");
    vi.stubEnv("INTEL_TDX_ATTESTATION_URL", "http://intel.test");
    vi.stubEnv("INTEL_TDX_API_KEY", "intel-key");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    if (originalEnv.nodeEnv !== undefined) {
      vi.stubEnv("NODE_ENV", originalEnv.nodeEnv);
    }
    if (originalEnv.intelUrl !== undefined) {
      vi.stubEnv("INTEL_TDX_ATTESTATION_URL", originalEnv.intelUrl);
    }
    if (originalEnv.intelKey !== undefined) {
      vi.stubEnv("INTEL_TDX_API_KEY", originalEnv.intelKey);
    }
    if (originalEnv.nearKey !== undefined) {
      vi.stubEnv("NEAR_AI_CLOUD_API_KEY", originalEnv.nearKey);
    }
    vi.resetAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearVerificationSession("chain-1");
    registerVerificationSession("chain-1", sessionNonce, "req", "res");
  });

  it("returns 200 when all verification steps succeed", async () => {
    const fetchSpy = vi.fn()
      // model attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...verifiedProofMock.attestation,
          model_attestations: [
            {
              signing_address: verifiedProofMock.signature?.signing_address,
              request_nonce: sessionNonce,
              nvidia_payload: { eat_nonce: sessionNonce, arch: "HOPPER", evidence_list: [] },
              intel_quote: {
                quote: "abc",
                mr_config: "db669af634b75c7f298400f3b6c2aa8ba54998bac83e23d10ab4eaadc4b50ccf",
                eat_nonce: sessionNonce,
              },
            },
          ],
        }),
      })
      // gateway attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            request_nonce: sessionNonce,
            intel_quote: {
              quote: "abc",
              mr_config: "db669af634b75c7f298400f3b6c2aa8ba54998bac83e23d10ab4eaadc4b50ccf",
              eat_nonce: sessionNonce,
            },
            event_log: {},
            info: { compose: "compose" },
          },
        }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            claims: {
              "x-nvidia-overall-att-result": true,
              "x-nvidia-eat-nonce": sessionNonce,
            },
          }),
      })
      // Intel verifier
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            nonce: sessionNonce,
            result: "OK",
            measurements: ["m1"],
            mr_config: "db669af634b75c7f298400f3b6c2aa8ba54998bac83e23d10ab4eaadc4b50ccf",
            report_data: `nonce=${sessionNonce};signer=${attestedAddress}`,
          }),
      })
      // Sigstore provenance
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repository: "near/nearai-cloud-api",
          tag: "v1.0.0",
          workflow: "release.yml",
        }),
      });

    vi.stubGlobal("fetch", fetchSpy);

  const { req, res, state } = mockReqRes({
    verificationId: "chain-1",
    nonce: sessionNonce,
    model: "m",
    expectedArch: "HOPPER",
    expectedDeviceCertHash: "hash",
    expectedRimHash: "rim",
    expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
  });

  it("returns 400 when signature text mismatches hashes", async () => {
    const fetchSpy = vi.fn()
      // model attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_attestations: [
            {
              signing_address: verifiedProofMock.signature?.signing_address,
              request_nonce: sessionNonce,
              nvidia_payload: { eat_nonce: sessionNonce, arch: "HOPPER", evidence_list: [] },
              intel_quote: { quote: "abc", mr_config: "hash", eat_nonce: sessionNonce },
            },
          ],
        }),
      })
      // gateway attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            request_nonce: sessionNonce,
            intel_quote: { quote: "abc", mr_config: "hash", eat_nonce: sessionNonce },
            event_log: {},
            info: { compose: "image: nearaidev/cloud-api@sha256:" + "0".repeat(64) },
          },
        }),
      })
      // signature
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...verifiedProofMock.signature, text: "badtext" }),
      })
      // NRAS
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            claims: {
              "x-nvidia-overall-att-result": true,
              "x-nvidia-eat-nonce": sessionNonce,
            },
          }),
      });

    vi.stubGlobal("fetch", fetchSpy);

  const { req, res, state } = mockReqRes({
    verificationId: "chain-1",
    nonce: sessionNonce,
    model: "m",
    expectedArch: "HOPPER",
    expectedDeviceCertHash: "hash",
    expectedRimHash: "rim",
    expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(400);
    expect(state.body?.error).toBe("Verification failed");
  });
});
