import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import * as jose from "jose";
import { generateKeyPairSync, sign } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { verificationConfig } from "@/config/verification";
import { resetJwksCache } from "../../src/pages/api/verification/nras";

function mockReqRes(body: any) {
  const req = { method: "POST", body, headers: {} } as unknown as NextApiRequest;
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

const makeToken = (payload: Record<string, any>) => {
  const header = Buffer.from(
    JSON.stringify({ kid: "kid1", alg: "ES384" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
};

const createSignedToken = async (payload: Record<string, any>) => {
  const kid = "kid1";
  const audience = verificationConfig.nras.audience;
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    aud: audience,
    eat_nonce: payload.eat_nonce ?? payload.nonce,
    "x-nvidia-overall-att-result": true,
    exp: now + 3600,
    nbf: now - 10,
    iat: now,
    ...payload,
  };

  const toBase64Url = (input: Buffer | string) =>
    (typeof input === "string" ? Buffer.from(input) : input)
      .toString("base64url");

  const headerB64 = toBase64Url(JSON.stringify({ alg: "ES256", kid }));
  const payloadB64 = toBase64Url(JSON.stringify(tokenPayload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = sign("sha256", Buffer.from(signingInput), privateKey);
  const token = `${signingInput}.${toBase64Url(signature)}`;

  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = "ES256";
  return { token, jwk };
};

describe("verification/nras API", () => {
  const prevMocks = { VERIFY_USE_MOCKS: process.env.VERIFY_USE_MOCKS };

  beforeAll(() => {
    process.env.VERIFY_USE_MOCKS = "false";
  });

  afterAll(() => {
    process.env.VERIFY_USE_MOCKS = prevMocks.VERIFY_USE_MOCKS;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    resetJwksCache();
  });

  it("returns verified in mock mode with expectations", async () => {
    process.env.VERIFY_USE_MOCKS = "true";
    const { req, res, state } = mockReqRes({
      nvidia_payload: {},
      nonce: "n",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    const handler = (await import("../../src/pages/api/verification/nras")).default;
    await handler(req, res);
    expect(state.status).toBe(200);
    expect(state.body?.verified).toBe(true);
  });

  it("requires expectations", async () => {
    process.env.VERIFY_USE_MOCKS = "false";
    const handler = (await import("../../src/pages/api/verification/nras")).default;
    const { req, res, state } = mockReqRes({
      nvidia_payload: {},
      nonce: "n",
    });
    await handler(req, res);
    expect(state.status).toBe(400);
  });

  it("returns arch mismatch reason (mocked crypto/fetch)", async () => {
    process.env.VERIFY_USE_MOCKS = "false";
    const { token, jwk } = await createSignedToken({ eat_nonce: "n1" });
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
        json: async () => ({ keys: [jwk] }),
      });
    const originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = fetchSpy as any;

    const handler = (await import("../../src/pages/api/verification/nras")).default;
    const { req, res, state } = mockReqRes({
      nvidia_payload: {
        nonce: "n1",
        arch: "HOPPER",
        evidence_list: [
          {
            device_cert_hash: "hash",
            rim_hash: "rim",
            device_id: "ueid",
            measurements: ["m1"],
          },
        ],
        device_cert_hash: "hash",
        rim: "rim",
        ueid: "ueid",
      },
      nonce: "n1",
      expectedArch: "ADA",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });

    try {
      await handler(req, res);
      expect(state.status).toBe(200);
      expect(state.body?.verified).toBe(false);
      expect(state.body?.reasons).toContain("GPU arch mismatch");
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it("handles JWT claim error", async () => {
    process.env.VERIFY_USE_MOCKS = "false";
    vi.doMock("crypto", async () => {
      const actual = await import("crypto");
      return {
        ...actual,
        createPublicKey: vi.fn(() => ({})),
        verify: vi.fn(() => true),
      };
    });
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = makeToken({
      exp: past,
      nbf: past - 100,
      aud: "wrong",
      eat_nonce: "nonceX",
    });

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ kid: "kid1", kty: "EC" }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([["JWT", token], { "GPU-0": "t" }]),
      } as any);

    const handler = (await import("../../src/pages/api/verification/nras")).default;
    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "nonceX", arch: "HOPPER", evidence_list: [] },
      nonce: "nonceX",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(500);
    expect(state.body?.error).toBe("Failed to reach NRAS");
  });

  it("handles network failure", async () => {
    process.env.VERIFY_USE_MOCKS = "false";
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network"));
    const handler = (await import("../../src/pages/api/verification/nras")).default;
    const { req, res, state } = mockReqRes({
      nvidia_payload: { nonce: "nonceX", arch: "HOPPER", evidence_list: [] },
      nonce: "nonceX",
      expectedArch: "HOPPER",
      expectedDeviceCertHash: "hash",
      expectedRimHash: "rim",
      expectedUeid: "ueid",
      expectedMeasurements: ["m1"],
    });
    await handler(req, res);
    expect(state.status).toBe(500);
  });
});
