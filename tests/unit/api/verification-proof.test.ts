import "../../vi-compat";
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import handler from "@/pages/api/verification/proof";
import type { NextApiRequest, NextApiResponse } from "next";
import { verifiedProofMock, mockNonce, mockAddress } from "../../fixtures/verification";
import { verifyMessage } from "ethers";
import * as requestHashUtils from "@/verification/hashes";
import * as screening from "@/server/screening";
import {
  registerVerificationSession,
  clearVerificationSession,
  getVerificationSession,
} from "@/verification/server";
import { rateLimitConfig } from "@/config/rateLimit";

const compatVi = vi as any;
if (!compatVi.stubGlobal) {
  compatVi.stubGlobal = (name: string, value: any) => {
    const previous = (globalThis as any)[name];
    (globalThis as any)[name] = value;
    return { restore: () => (previous === undefined ? delete (globalThis as any)[name] : (globalThis as any)[name] = previous) };
  };
}
if (!compatVi.resetModules) {
  compatVi.resetModules = () => {
    vi.resetAllMocks();
    vi.clearAllMocks();
  };
}

vi.mock("ethers", () => ({
  verifyMessage: vi.fn(() => mockAddress),
}));

const fixedNonce = mockNonce;
const gatewayAttestation = {
  request_nonce: fixedNonce,
  signing_address: verifiedProofMock.signature?.signing_address,
  nvidia_payload: {
    eat_nonce: fixedNonce,
    arch: "HOPPER",
    evidence_list: [],
  },
  intel_quote: { eat_nonce: fixedNonce },
  event_log: [{}],
};

const baseVerificationPayload = {
  verificationId: "id1",
  nonce: fixedNonce,
  expectedArch: "HOPPER",
  expectedDeviceCertHash: "hash",
  expectedRimHash: "rim",
  expectedUeid: "ueid",
  expectedMeasurements: ["m1"],
};
const createVerificationBody = (overrides: Record<string, any> = {}) => ({
  ...baseVerificationPayload,
  ...overrides,
});

const defaultNrasResponse = {
  verified: true,
  claims: {
    "x-nvidia-overall-att-result": true,
    "x-nvidia-eat-nonce": fixedNonce,
  },
};

const stubStandardFetch = (nrasResponse = defaultNrasResponse) => {
  const fetchSpy = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ gateway_attestation: gatewayAttestation }) })
    .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
    .mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(nrasResponse),
    });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
};

function mockReqRes(body: any) {
  const req = {
    method: "POST",
    body,
    headers: { host: "localhost:3000" } as Record<string, any>,
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

describe("verification/proof API (mock)", () => {
  const prev = process.env.VERIFY_USE_MOCKS;
  beforeEach(() => {
    clearVerificationSession("id1");
    registerVerificationSession("id1", fixedNonce, "req", "res");
  });
  beforeAll(() => {
    process.env.VERIFY_USE_MOCKS = "true";
    process.env.NEAR_AI_CLOUD_API_KEY = "mock-key";
  });
  afterAll(() => {
    process.env.VERIFY_USE_MOCKS = prev;
  });

  it("returns canonical results when inputs provided", async () => {
    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.results?.verified).toBe(true);
    expect(state.body?.results?.gpu?.verified).toBe(true);
  });

  it("fails when nonce missing", async () => {
    clearVerificationSession("id1");
    const { req, res, state } = mockReqRes({
      verificationId: "id1",
    });
    await handler(req, res);
    expect(state.status).toBe(400);
    expect(state.body?.error).toMatch(/Verification session not registered/i);
  });

  it("fails when verificationId missing", async () => {
    const { req, res, state } = mockReqRes({
      nonce: fixedNonce,
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(400);
    expect(state.body?.error).toMatch(/verificationId is required/i);
  });

  it("returns configMissing when NEAR key absent", async () => {
    process.env.NEAR_AI_CLOUD_API_KEY = "";
    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(500);
    expect(state.body?.error).toMatch(/verification failed/i);
    process.env.NEAR_AI_CLOUD_API_KEY = "mock-key";
  });

  it("rejects when client request hash conflicts with stored session hash", async () => {
    const { req, res, state } = mockReqRes(
      createVerificationBody({ requestHash: "different" })
    );
    await handler(req, res);
    expect(state.status).toBe(400);
    expect(state.body?.error).toMatch(/Provided request hash conflicts/i);
  });

  it("rejects when client response hash conflicts with stored session hash", async () => {
    const { req, res, state } = mockReqRes(
      createVerificationBody({ responseHash: "different" })
    );
    await handler(req, res);
    expect(state.status).toBe(400);
    expect(state.body?.error).toMatch(/Provided response hash conflicts/i);
  });

  it("accepts matching client hashes and proceeds", async () => {
    const { req, res, state } = mockReqRes(
      createVerificationBody({
        requestHash: "REQ",
        responseHash: "RES",
      })
    );
    await handler(req, res);
    expect(state.status).toBe(200);
  });

  it("stores client hashes when session is missing them", async () => {
    clearVerificationSession("id1");
    registerVerificationSession("id1", fixedNonce);

    const { req, res, state } = mockReqRes(
      createVerificationBody({
        requestHash: "NEWREQ",
        responseHash: "NEWRES",
      })
    );
    await handler(req, res);
    expect(state.status).toBe(200);

    const session = getVerificationSession("id1");
    expect(session?.requestHash).toBe("newreq");
    expect(session?.responseHash).toBe("newres");
  });

  it("reuses existing session hashes when client provides none", async () => {
    const { req, res, state } = mockReqRes(
      createVerificationBody({ requestHash: undefined, responseHash: undefined })
    );
    await handler(req, res);
    expect(state.status).toBe(200);

    const session = getVerificationSession("id1");
    expect(session?.requestHash).toBe("req");
    expect(session?.responseHash).toBe("res");
  });
});

describe("verification/proof API (mocked fetch)", () => {
  const prev = process.env.VERIFY_USE_MOCKS;
  const prevIntelUrl = process.env.INTEL_TDX_ATTESTATION_URL;
  const prevIntelKey = process.env.INTEL_TDX_API_KEY;

  beforeAll(() => {
    process.env.VERIFY_USE_MOCKS = "false";
    process.env.NEAR_AI_CLOUD_API_KEY = "mock-key";
    process.env.INTEL_TDX_ATTESTATION_URL = "http://intel.test";
    process.env.INTEL_TDX_API_KEY = "intel-key";
  });

  afterAll(() => {
    process.env.VERIFY_USE_MOCKS = prev;
    process.env.INTEL_TDX_ATTESTATION_URL = prevIntelUrl;
    process.env.INTEL_TDX_API_KEY = prevIntelKey;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    clearVerificationSession("id1");
    registerVerificationSession("id1", fixedNonce, "req", "res");
  });

  it("handles happy path with mocked attestation/signature/NRAS", async () => {
    const fetchSpy = vi.fn()
      // attestation
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
      // gateway attestation
      .mockResolvedValueOnce({ ok: true, json: async () => ({ gateway_attestation: gatewayAttestation }) })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.results?.verified).toBe(true);
    expect(state.body?.nras?.verified).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("never uses the Origin header when proxying NRAS", async () => {
    const fetchSpy = stubStandardFetch();
    const { req, res, state } = mockReqRes({
      ...createVerificationBody({ model: "m" }),
    });
    req.headers.origin = "https://attacker.com";
    await handler(req, res);
    expect(state.status).toBe(200);
    const nrasCall = fetchSpy.mock.calls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("/api/verification/nras")
    );
    expect(nrasCall?.[0]).toBe("http://localhost:3000/api/verification/nras");
  });

  it("rejects internal origin values when building NRAS URL", async () => {
    const fetchSpy = stubStandardFetch();
    const { req, res, state } = mockReqRes({
      ...createVerificationBody({ model: "m" }),
    });
    req.headers.origin = "http://internal-service:8080";
    await handler(req, res);
    expect(state.status).toBe(200);
    const nrasCall = fetchSpy.mock.calls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("/api/verification/nras")
    );
    expect(nrasCall?.[0]).toBe("http://localhost:3000/api/verification/nras");
  });

  it("falls back to NEXT_PUBLIC_SITE_URL when Origin is absent", async () => {
    const previousUrl = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://dashboard.near.ai";
    try {
      const fetchSpy = stubStandardFetch();
      const { req, res, state } = mockReqRes({
        ...createVerificationBody({ model: "m" }),
      });
      delete req.headers.origin;
      await handler(req, res);
      expect(state.status).toBe(200);
      const nrasCall = fetchSpy.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("/api/verification/nras")
      );
      expect(nrasCall?.[0]).toBe(
        "https://dashboard.near.ai/api/verification/nras"
      );
    } finally {
      if (previousUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SITE_URL;
      } else {
        process.env.NEXT_PUBLIC_SITE_URL = previousUrl;
      }
    }
  });

  it("fetches ed25519 signatures when requested", async () => {
    const edAddress = "ed25519:abc";
    const edGateway = {
      ...gatewayAttestation,
      signing_address: edAddress,
      intel_quote: { quote: "abc", eat_nonce: fixedNonce },
      nvidia_payload: {
        eat_nonce: fixedNonce,
        arch: "HOPPER",
        evidence_list: [],
      },
      event_log: [{}],
    };
    const responses = [
      // attestation
      {
        ok: true,
        json: async () => ({
          request_nonce: fixedNonce,
          model_attestations: [
            {
              signing_address: edAddress,
              nvidia_payload: { eat_nonce: fixedNonce, arch: "HOPPER", evidence_list: [] },
              intel_quote: { quote: "abc", eat_nonce: fixedNonce },
            },
          ],
        }),
      },
      // gateway attestation
      {
        ok: true,
        json: async () => ({
          gateway_attestation: edGateway,
        }),
      },
      // signature (ed25519)
      {
        ok: true,
        json: async () => ({
          ...verifiedProofMock.signature,
          signing_algo: "ed25519",
          signing_address: edAddress,
          signature: "ed25519sig",
        }),
      },
      // NRAS from signature fetch
      {
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            claims: { "x-nvidia-overall-att-result": true, "x-nvidia-eat-nonce": fixedNonce },
          }),
      },
      // auto NRAS verification for model attestation
      {
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            claims: { "x-nvidia-overall-att-result": true, "x-nvidia-eat-nonce": fixedNonce },
          }),
      },
      // auto NRAS verification for gateway attestation
      {
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            claims: { "x-nvidia-overall-att-result": true, "x-nvidia-eat-nonce": fixedNonce },
          }),
      },
      // intel verifier for model quote
      {
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            nonce: fixedNonce,
            result: "OK",
            measurements: ["m1"],
            report_data: `${fixedNonce}${edAddress}`,
          }),
      },
      // intel verifier for gateway quote
      {
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            nonce: fixedNonce,
            result: "OK",
            measurements: ["m1"],
            report_data: `${fixedNonce}${edAddress}`,
          }),
      },
    ];

    type FetchMock = (input: string, init?: RequestInit) => Promise<any>;
    const fetchSpy = vi.fn<FetchMock>(async () => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected fetch call");
      return next as any;
    });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      signingAlgo: "ed25519",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    const signatureUrl = fetchSpy.mock.calls[2]?.[0];
    expect(typeof signatureUrl).toBe("string");
    if (typeof signatureUrl === "string") {
      expect(signatureUrl).toContain("signing_algo=ed25519");
    }
  });

  it("fails verification when the signer is not attested", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ gateway_attestation: gatewayAttestation }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...verifiedProofMock.signature,
          signing_address: "0x00000000000000000000000000000000DeAdBeE7",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);
    const verifyMessageMock = vi.mocked(verifyMessage);
    verifyMessageMock.mockReturnValue("0x00000000000000000000000000000000DeAdBeE7");

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.results?.verified).toBe(false);
    expect(state.body?.results?.reasons).toContain("Signer does not match attested key");
    verifyMessageMock.mockReturnValue(mockAddress);
  });

  it("fails when attested or NRAS nonce does not match session nonce", async () => {
    const fixedNonce = "a".repeat(64);
    clearVerificationSession("id1");
    registerVerificationSession("id1", fixedNonce, "req", "res");

    const fetchSpy = vi
      .fn()
      // attestation with matching request_nonce but mismatched attested nonce
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_nonce: fixedNonce,
          gateway_attestation: {
            request_nonce: fixedNonce,
            signing_address: verifiedProofMock.signature?.signing_address,
            nvidia_payload: {
              eat_nonce: "b".repeat(64),
              arch: "HOPPER",
              evidence_list: [],
            },
            intel_quote: { eat_nonce: "b".repeat(64) },
            event_log: [{}],
          },
        }),
      })
      // gateway attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gateway_attestation: gatewayAttestation }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS with different nonce
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            claims: {
              "x-nvidia-overall-att-result": true,
              "x-nvidia-eat-nonce": "c".repeat(64),
            },
            reasons: [],
          }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);

    expect(state.status).toBe(502);
    expect(state.body?.error).toBe("Verification failed");
    const session = getVerificationSession("id1");
    expect(session?.nonce).toBe(fixedNonce);
  });

  it("does not override session hashes when only one signed hash is present", async () => {
    const extractSpy = vi
      .spyOn(requestHashUtils, "extractHashesFromSignedText")
      .mockReturnValue(null);

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ gateway_attestation: gatewayAttestation }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...verifiedProofMock.signature, text: "req:res" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.body?.requestHash).toBe("req");
    expect(state.body?.responseHash).toBe("res");
    expect(state.body?.sessionRequestHash).toBe("req");
    expect(state.body?.results?.info || []).not.toContain(
      expect.stringContaining("Session hashes did not match")
    );
    extractSpy.mockRestore();
  });

  it("overrides hashes and emits info when signed pair differs from session", async () => {
    const extractSpy = vi
      .spyOn(requestHashUtils, "extractHashesFromSignedText")
      .mockReturnValue({
        requestHash: "signed-req",
        responseHash: "signed-res",
      });

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ gateway_attestation: gatewayAttestation }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...verifiedProofMock.signature,
          text: `${"1".repeat(64)}:${"2".repeat(64)}`,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(400);
    extractSpy.mockRestore();
  });

  it("uses signed hashes when they match session without emitting mismatch info", async () => {
    const extractSpy = vi
      .spyOn(requestHashUtils, "extractHashesFromSignedText")
      .mockReturnValue({
        requestHash: "req-session",
        responseHash: "res-session",
      });

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ gateway_attestation: gatewayAttestation }) })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.body?.requestHash).toBe("req");
    expect(state.body?.responseHash).toBe("res");
    expect(state.body?.sessionRequestHash).toBe("req");
    expect(state.body?.results?.info || []).not.toContain(
      expect.stringContaining("Session hashes did not match")
    );
    extractSpy.mockRestore();
  });

  it("propagates NRAS error", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ gateway_attestation: gatewayAttestation }) })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: false,
            claims: { "x-nvidia-eat-nonce": fixedNonce },
            reasons: ["NRAS error"],
          }),
        status: 200,
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.nras?.verified).toBe(false);
  });

  it("handles attestation 404 gracefully", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gateway_attestation: gatewayAttestation }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.attestation?.gateway_attestation).toBeTruthy();
  });

  it("accepts model attestation without request_nonce when nonce matches", async () => {
    const fetchSpy = vi.fn()
      // model attestation without request_nonce
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_attestations: [
            {
              signing_address: verifiedProofMock.signature?.signing_address,
              nvidia_payload: {
                eat_nonce: fixedNonce,
                arch: "HOPPER",
                evidence_list: [],
              },
              intel_quote: { eat_nonce: fixedNonce },
            },
          ],
        }),
      })
      // gateway attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gateway_attestation: gatewayAttestation }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS with matching nonce
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            claims: {
              "x-nvidia-overall-att-result": true,
              "x-nvidia-eat-nonce": fixedNonce,
            },
          }),
      })
      // NRAS auto-verification call
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            claims: {
              "x-nvidia-overall-att-result": true,
              "x-nvidia-eat-nonce": fixedNonce,
            },
          }),
      })
      // Intel verifier success
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            nonce: fixedNonce,
            measurements: ["m1"],
            result: "OK",
          }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.nonceCheck?.valid).toBe(true);
  });

  it("sets configMissing when Intel verifier URL missing", async () => {
    delete process.env.INTEL_TDX_ATTESTATION_URL;
    const fetchSpy = vi
      .fn()
      // attestation (with intel quote)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_nonce: fixedNonce,
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            intel_quote: { quote: "abc" },
          },
        }),
      })
      // gateway
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gateway_attestation: gatewayAttestation }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(500);
    expect(state.body?.configMissing?.intel).toBe(true);
  });

  it("sets configMissing when Intel API key missing", async () => {
    process.env.INTEL_TDX_ATTESTATION_URL = "http://intel.test";
    const prevKey = process.env.INTEL_TDX_API_KEY;
    delete process.env.INTEL_TDX_API_KEY;
    const fetchSpy = vi
      .fn()
      // attestation (with intel quote)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_nonce: fixedNonce,
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            intel_quote: { quote: "abc" },
          },
        }),
      })
      // gateway
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gateway_attestation: gatewayAttestation }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS skipped
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(500);
    expect(state.body?.configMissing?.intelApiKey).toBe(true);

    // Restore for subsequent tests
    if (prevKey !== undefined) {
      process.env.INTEL_TDX_API_KEY = prevKey;
    }
  });

  it("returns 502 when both attestation and signature missing", async () => {
    const fetchSpy = vi
      .fn()
      // attestation missing
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "no attestation" })
      // gateway missing
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "no gateway" })
      // signature missing
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "no signature" });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(502);
    expect(state.body?.error).toContain("Failed to fetch verification proof");
    expect(String(state.body?.details || state.body?.error || "")).toBeTruthy();
  });

  it("returns 504 on fetch timeout", async () => {
    const abortError = new Error("Aborted");
    // @ts-ignore
    abortError.name = "AbortError";
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError);

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(504);
    expect(state.body?.error).toContain("Verification proof request timed out");
    consoleSpy.mockRestore();
  });

  it("sets intel error when Intel verifier returns non-200", async () => {
    process.env.INTEL_TDX_ATTESTATION_URL = "http://intel.test";
    const fetchSpy = vi
      .fn()
      // attestation with intel quote
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_nonce: fixedNonce,
          gateway_attestation: {
            ...gatewayAttestation,
            intel_quote: { quote: "abc", eat_nonce: fixedNonce },
          },
        }),
      })
      // gateway attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gateway_attestation: { ...gatewayAttestation, intel_quote: { quote: "abc", eat_nonce: fixedNonce } } }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      })
      // Intel verifier non-200
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "intel error" });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
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

  it("sets intel mismatch when nonce differs", async () => {
    const fetchSpy = vi
      .fn()
      // attestation with intel quote
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_nonce: fixedNonce,
          gateway_attestation: {
            ...gatewayAttestation,
            intel_quote: { quote: "abc", eat_nonce: fixedNonce },
          },
        }),
      })
      // gateway attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gateway_attestation: { ...gatewayAttestation, intel_quote: { quote: "abc", eat_nonce: fixedNonce } } }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      })
      // Intel verifier success with wrong nonce
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            nonce: "wrong",
            result: "OK",
            measurements: ["m1"],
          }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
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

  it("marks intel verified on success", async () => {
    const fetchSpy = vi
      .fn()
      // attestation with intel quote
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gateway_attestation: {
            ...gatewayAttestation,
            intel_quote: { quote: "abc", eat_nonce: fixedNonce },
          },
        }),
      })
      // gateway attestation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gateway_attestation: { ...gatewayAttestation, intel_quote: { quote: "abc", eat_nonce: fixedNonce } } }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // NRAS
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      })
      // Intel verifier success with matching nonce
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            nonce: fixedNonce,
            result: "OK",
            measurements: ["m1"],
          }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
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
});

describe("verification/proof API auth & rate limit", () => {
  const originalEnv = {
    nodeEnv: process.env.NODE_ENV,
    verifyMocks: process.env.VERIFY_USE_MOCKS,
    apiKey: process.env.NEAR_AI_CLOUD_API_KEY,
  };

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERIFY_USE_MOCKS", "false");
    vi.stubEnv("NEAR_AI_CLOUD_API_KEY", "mock-key");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    if (originalEnv.nodeEnv !== undefined) {
      vi.stubEnv("NODE_ENV", originalEnv.nodeEnv);
    }
    if (originalEnv.verifyMocks !== undefined) {
      vi.stubEnv("VERIFY_USE_MOCKS", originalEnv.verifyMocks);
    }
    if (originalEnv.apiKey !== undefined) {
      vi.stubEnv("NEAR_AI_CLOUD_API_KEY", originalEnv.apiKey);
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
    });

    await handler(req, res);
    expect(state.status).toBe(401);
  });

  it("returns 429 when over the rate limit", async () => {
    vi.spyOn(screening, "verifyNearAuth").mockResolvedValue({
      token: "token",
      result: { accountId: "limited.near" } as any,
    });

    const limit = rateLimitConfig.verificationProof.maxRequests;
    for (let i = 0; i < limit; i++) {
      const { req, res } = mockReqRes({});
      req.headers.authorization = "Bearer token";
      await handler(req, res);
    }

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: fixedNonce,
    });
    req.headers.authorization = "Bearer token";
    await handler(req, res);
    expect(state.status).toBe(429);
  });
});
