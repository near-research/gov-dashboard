import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import handler from "@/pages/api/verification/proof";
import type { NextApiRequest, NextApiResponse } from "next";
import { verifiedProofMock } from "../../fixtures/verification";
import * as requestHashUtils from "@/utils/request-hash";
import {
  registerVerificationSession,
  clearVerificationSession,
} from "@/server/verificationSessions";

vi.mock("ethers", () => ({
  ethers: {
    verifyMessage: vi.fn(() => "0x856039d8a60613528d1DBEc3dc920f5FE96a31A0"),
  },
}));

function mockReqRes(body: any) {
  const req = { method: "POST", body, headers: { host: "localhost:3000" } } as unknown as NextApiRequest;
  const state = { status: 200, body: undefined as any };
  const res = {
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
    registerVerificationSession("id1", "nonce123", "req-session", "res-session");
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
      nonce: "nonce123",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.results?.verified).toBe(false);
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
      nonce: "nonce123",
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
      nonce: "nonce123",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(500);
    expect(state.body?.configMissing?.nearApiKey).toBe(true);
    process.env.NEAR_AI_CLOUD_API_KEY = "mock-key";
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
    registerVerificationSession("id1", "nonce123", "req-session", "res-session");
  });

  it("handles happy path with mocked attestation/signature/NRAS", async () => {
    const fetchSpy = vi.fn()
      // attestation
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
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
      nonce: "nonce123",
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
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not override session hashes when only one signed hash is present", async () => {
    const extractSpy = vi
      .spyOn(requestHashUtils, "extractHashesFromSignedText")
      .mockReturnValue({ requestHash: "signed-only", responseHash: undefined });

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...verifiedProofMock.signature, text: "signed-only" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.body?.requestHash).toBe("req-session");
    expect(state.body?.responseHash).toBe("res-session");
    expect(state.body?.sessionRequestHash).toBe("req-session");
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
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.body?.requestHash).toBe("signed-req");
    expect(state.body?.responseHash).toBe("signed-res");
    expect(state.body?.sessionRequestHash).toBe("req-session");
    expect(
      (state.body?.results?.info || []).some((msg: string) =>
        msg.includes("Session hashes did not match")
      )
    ).toBe(true);
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
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(verifiedProofMock.nras),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.body?.requestHash).toBe("req-session");
    expect(state.body?.responseHash).toBe("res-session");
    expect(state.body?.sessionRequestHash).toBe("req-session");
    expect(state.body?.results?.info || []).not.toContain(
      expect.stringContaining("Session hashes did not match")
    );
    extractSpy.mockRestore();
  });

  it("propagates NRAS error", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.attestation })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      .mockResolvedValueOnce({
        ok: false,
        text: async () => "NRAS error",
        status: 400,
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: "nonce123",
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
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature });
    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.attestation).toBeNull();
  });

  it("sets configMissing when Intel verifier URL missing", async () => {
    delete process.env.INTEL_TDX_ATTESTATION_URL;
    const fetchSpy = vi
      .fn()
      // attestation (with intel quote)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            intel_quote: { quote: "abc" },
          },
        }),
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
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.configMissing?.intel).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // attestation, signature (NRAS may be skipped)
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
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            intel_quote: { quote: "abc" },
          },
        }),
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
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.configMissing?.intelApiKey).toBe(true);
    expect(state.body?.intel?.error).toMatch(/not configured/i);

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
      // signature missing
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "no signature" });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: "nonce123",
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
      nonce: "nonce123",
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
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            intel_quote: { quote: "abc" },
          },
        }),
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
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.intel?.verified).toBe(false);
    const reasons = state.body?.intel?.reasons || [];
    expect(reasons.length > 0 || state.body?.intel?.error || state.body?.intel?.details).toBeTruthy();
  });

  it("sets intel mismatch when nonce differs", async () => {
    const fetchSpy = vi
      .fn()
      // attestation with intel quote
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            intel_quote: { quote: "abc" },
          },
        }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
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
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.intel?.verified).toBe(false);
    expect(
      state.body?.intel?.reasons?.some((r: string) => r.toLowerCase().includes("nonce"))
    ).toBe(true);
  });

  it("marks intel verified on success", async () => {
    const fetchSpy = vi
      .fn()
      // attestation with intel quote
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gateway_attestation: {
            signing_address: verifiedProofMock.signature?.signing_address,
            intel_quote: { quote: "abc" },
          },
        }),
      })
      // signature
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedProofMock.signature })
      // Intel verifier success with matching nonce
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            verified: true,
            nonce: "nonce123",
            result: "OK",
            measurements: ["m1"],
          }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const { req, res, state } = mockReqRes({
      verificationId: "id1",
      nonce: "nonce123",
      model: "m",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.intel?.verified).toBe(true);
    expect(state.body?.results?.cpu?.verified).toBe(true);
    expect(state.body?.results?.verified).toBeDefined();
  });
});
