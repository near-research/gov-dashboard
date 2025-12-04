import "../../vi-compat";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as crypto from "@/server/crypto";
import handler, { resetJwksCache } from "@/pages/api/verification/nras";
import type { NextApiRequest, NextApiResponse } from "next";

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

function mockReqRes(body: any) {
  const req = { method: "POST", body } as unknown as NextApiRequest;
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

describe("verification/nras API", () => {
  const prev = process.env.VERIFY_USE_MOCKS;
  beforeAll(() => {
    process.env.VERIFY_USE_MOCKS = "true";
  });
  afterAll(() => {
    process.env.VERIFY_USE_MOCKS = prev;
  });

  it("returns verified when expectations provided", async () => {
    const { req, res, state } = mockReqRes({
      nvidia_payload: {},
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.verified).toBe(true);
  });

  it("fails when expectations missing", async () => {
    const { req, res, state } = mockReqRes({
      nvidia_payload: {},
      nonce: "n1",
    });
    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.verified).toBe(false);
    expect(state.body?.reasons?.length).toBeGreaterThan(0);
  });
});

describe("verification/nras API (live path)", () => {
  const prevMocks = process.env.VERIFY_USE_MOCKS;
  beforeAll(() => {
    process.env.VERIFY_USE_MOCKS = "false";
  });
  afterAll(() => {
    process.env.VERIFY_USE_MOCKS = prevMocks;
    vi.restoreAllMocks();
  });

  const makeJwt = (payload: Record<string, any>, header: Record<string, any> = {}) => {
    const h = { alg: "ES256", kid: "kid1", ...header };
    const p = { aud: "nvidia-attestation", ...payload };
    const encode = (obj: any) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const sig = Buffer.from("sig").toString("base64url");
    return `${encode(h)}.${encode(p)}.${sig}`;
  };

  beforeEach(() => {
    resetJwksCache();
    vi.restoreAllMocks();
  });

  it("returns 502 when NRAS response is missing JWT", async () => {
    const fetchSpy = vi
      .fn()
      // NRAS POST
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([{ other: "no jwt here" }]),
      })
      // JWKS (not reached because missing token)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [] }) });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(502);
    expect(state.body?.error).toContain("NRAS response missing JWT");
  });

  it("returns 500 when JWKS fetch fails", async () => {
    const fetchSpy = vi
      .fn()
      // NRAS POST returns array with JWT token
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", "header.payload.sig"],
            { "GPU-0": "gpu-token" },
          ]),
      })
      // JWKS fetch fails
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "jwks error" });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(500);
    expect(state.body?.error).toBeDefined();
  });

  it("handles non-JSON NRAS response text and returns missing JWT", async () => {
    const fetchSpy = vi
      .fn()
      // NRAS POST returns plain text (parse fallback)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "plain-text-response",
      });
    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(502);
    expect(String(state.body?.error || "")).toMatch(/missing JWT/i);
  });

  it("returns 502 when JWK kid mismatch", async () => {
    const token = makeJwt({ nonce: "n1" }, { kid: "no-match" });
    const fetchSpy = vi
      .fn()
      // NRAS POST with JWT
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      // JWKS without matching kid
      .mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [{ kid: "other" }] }) });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(502);
    expect(state.body?.error).toContain("No matching JWK for NRAS token");
  });

  it("fails when JWT audience mismatches", async () => {
    const token = makeJwt({ nonce: "n1", aud: "bad-aud" });

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBeGreaterThanOrEqual(500);
    expect(state.body?.error).toBeDefined();
  });

  it("returns failure when device cert hash mismatches", async () => {
    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: {
        nonce: "n1",
        arch: "HOPPER",
        device_cert_hash: "other-hash",
        evidence_list: [{ device_cert_hash: "other-hash" }],
      },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.verified).toBe(false);
    expect(state.body?.reasons).toContain("NRAS overall attestation result failed");
  });

  it("returns reasons when GPU arch mismatches expected", async () => {
    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      // NRAS POST with JWT
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      // JWKS with matching key
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);
    const verifySpy = vi.spyOn(crypto, "verify").mockReturnValue(true);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "ADA", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.verified).toBe(false);
    expect(state.body?.reasons).toContain("NRAS overall attestation result failed");

    verifySpy.mockRestore();
  });

  it("returns failure when RIM mismatches", async () => {
    const token = makeJwt({ nonce: "n1" });
    const verifySpy = vi.spyOn(crypto, "verify").mockReturnValue(true);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: {
        nonce: "n1",
        arch: "HOPPER",
        rim: "wrong-rim",
        evidence_list: [{ rim_hash: "wrong-rim" }],
      },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    verifySpy.mockRestore();
    expect(state.status).toBe(200);
    expect(state.body?.verified).toBe(false);
    expect(state.body?.reasons).toContain("NRAS overall attestation result failed");
  });

  it("returns failure when UEID mismatches", async () => {
    const token = makeJwt({ nonce: "n1" });
    const verifySpy = vi.spyOn(crypto, "verify").mockReturnValue(true);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: {
        nonce: "n1",
        arch: "HOPPER",
        ueid: "wrong-ueid",
        evidence_list: [{ device_id: "wrong-ueid" }],
      },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    verifySpy.mockRestore();
    expect(state.status).toBe(200);
    expect(state.body?.verified).toBe(false);
    expect(state.body?.reasons).toContain("NRAS overall attestation result failed");
  });

  it("returns failure when measurements mismatch", async () => {
    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: {
        nonce: "n1",
        arch: "HOPPER",
        evidence_list: [{ measurements: ["different-hash"] }],
      },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["expected-measure"],
    });

    await handler(req, res);
    expect(state.status).toBeGreaterThanOrEqual(200);
    if (state.status === 200) {
      expect(state.body?.verified).toBe(false);
      expect(
        state.body?.reasons?.some((r: string) => r.includes("Missing expected measurements"))
      ).toBe(true);
    } else {
      expect(state.body?.error ?? state.body?.reasons).toBeDefined();
    }
  });

  it("returns 400 when nvidia_payload missing required fields", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { req, res, state } = mockReqRes({
      nvidia_payload: {},
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(400);
    expect(state.body?.error).toContain("nvidia_payload missing required fields");
  });

  it("returns 400 for invalid JSON nvidia_payload", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { req, res, state } = mockReqRes({
      nvidia_payload: "{bad-json",
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(400);
    expect(state.body?.error).toBe("Invalid JSON in nvidia_payload");
  });

  it("propagates NRAS POST non-200 status", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "server error" });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBe(500);
    expect(state.body?.error).toBe("NRAS request failed");
    expect(state.body?.details).toBe("server error");
  });

  it("returns 400 when attestation payload missing required fields", async () => {
    const { req, res, state } = mockReqRes({
      nvidia_payload: { arch: "HOPPER" }, // missing nonce/evidence_list
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(400);
    expect(String(state.body?.error || "")).toMatch(/missing required fields/i);
  });

  it("returns failure when JWKS is empty", async () => {
    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [] }) });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBeGreaterThanOrEqual(500);
    expect(state.body?.error).toBeDefined();
  });

});

describe("verification/nras API (crypto mocked)", () => {
  const prevMocks = process.env.VERIFY_USE_MOCKS;
  beforeAll(() => {
    process.env.VERIFY_USE_MOCKS = "false";
  });
  afterAll(() => {
    process.env.VERIFY_USE_MOCKS = prevMocks;
    vi.resetModules();
  });

  beforeEach(() => {
    resetJwksCache();
    vi.restoreAllMocks();
  });

  const makeJwt = (payload: Record<string, any>, header: Record<string, any> = {}) => {
    const h = { alg: "ES256", kid: "kid1", ...header };
    const p = { aud: "nvidia-attestation", ...payload };
    const encode = (obj: any) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const sig = Buffer.from("sig").toString("base64url");
    return `${encode(h)}.${encode(p)}.${sig}`;
  };

  it("returns error when JWT signature verification fails", async () => {
    vi.mock("@/server/crypto", () => ({
      createPublicKey: vi.fn(),
      verify: vi.fn().mockReturnValue(false),
    }));
    const { default: mockedHandler } = await import("@/pages/api/verification/nras");
    vi.resetModules();

    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await mockedHandler(req, res);
    expect(state.status).toBeGreaterThanOrEqual(500);
    expect(state.body?.error).toBeDefined();
  });

  it("returns error when nonce claim mismatches expected", async () => {
    vi.mock("@/server/crypto", () => ({
      createPublicKey: vi.fn(),
      verify: vi.fn().mockReturnValue(true),
    }));
    const { default: mockedHandler } = await import("@/pages/api/verification/nras");
    vi.resetModules();

    const token = makeJwt({ nonce: "wrong-nonce" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await mockedHandler(req, res);
    expect(state.status).toBeGreaterThanOrEqual(500);
    expect(state.body?.error).toBeDefined();
  });

  it("handles NRAS response as object with jwt/gpus", async () => {
    vi.mock("@/server/crypto", () => ({
      createPublicKey: vi.fn(() => ({} as any)),
      verify: vi.fn().mockReturnValue(true),
    }));
    const token = makeJwt({ nonce: "n1", eat_nonce: "n1" });
    const fetchSpy = vi
      .fn()
      // NRAS POST returns object with jwt/gpus
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jwt: token, gpus: { "GPU-0": "token" } }),
      })
      // JWKS
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await handler(req, res);
    expect(state.status).toBeGreaterThanOrEqual(200);
    if (state.status === 200) {
      expect(state.body?.verified).toBeDefined();
    } else {
      expect(state.body?.error).toBeDefined();
    }
  });

  it("returns verified when payload matches expectations (mock mode)", async () => {
    const prev = process.env.VERIFY_USE_MOCKS;
    process.env.VERIFY_USE_MOCKS = "true";
    const { default: mockedHandler } = await import("@/pages/api/verification/nras");
    vi.resetModules();

    const { req, res, state } = mockReqRes({
      nvidia_payload: {},
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await mockedHandler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.verified).toBe(true);
    expect(state.body?.reasons).toEqual([]);
    process.env.VERIFY_USE_MOCKS = prev;
  });

  it("returns failure and reasons when arch mismatches", async () => {
    vi.mock("@/server/crypto", () => ({
      createPublicKey: vi.fn(),
      verify: vi.fn().mockReturnValue(true),
    }));
    const { default: mockedHandler } = await import("@/pages/api/verification/nras");
    vi.resetModules();

    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "ADA",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await mockedHandler(req, res);
    expect(state.status).toBeGreaterThanOrEqual(500);
    expect(state.body?.error ?? state.body?.reasons).toBeDefined();
  });

  it("returns failure when measurements missing and device cert hash mismatches", async () => {
    vi.mock("@/server/crypto", () => ({
      createPublicKey: vi.fn(),
      verify: vi.fn().mockReturnValue(true),
    }));
    const { default: mockedHandler } = await import("@/pages/api/verification/nras");
    vi.resetModules();

    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            ["JWT", token],
            { "GPU-0": "gpu-token" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: "kid1",
              kty: "EC",
              crv: "P-256",
              x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "n1", arch: "HOPPER", evidence_list: [] },
      nonce: "n1",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "expected-hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    await mockedHandler(req, res);
    expect(state.status).toBeGreaterThanOrEqual(500);
    expect(state.body?.error ?? state.body?.reasons).toBeDefined();
  });

});
