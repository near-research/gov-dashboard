import "../../vi-compat";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import handler, { resetJwksCache } from "@/pages/api/verification/nras";
import * as crypto from "@/server/crypto";
import type { NextApiRequest, NextApiResponse } from "next";

const makeJwt = (payload: Record<string, any>, header: Record<string, any> = {}) => {
  const h = { alg: "ES256", kid: "kid1", ...header };
  const p = { aud: "nvidia-attestation", ...payload };
  const encode = (obj: any) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sig = Buffer.from("sig").toString("base64url");
  return `${encode(h)}.${encode(p)}.${sig}`;
};

const mockReqRes = (body: any) => {
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
};

describe("verification/nras telemetry", () => {
  const prevMocks = process.env.VERIFY_USE_MOCKS;
  beforeAll(() => {
    process.env.VERIFY_USE_MOCKS = "false";
  });
  afterAll(() => {
    process.env.VERIFY_USE_MOCKS = prevMocks;
  });

  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetJwksCache();
    vi.restoreAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

const basePayload = {
  nvidia_payload: {
    nonce: "n1",
    arch: "HOPPER",
    evidence_list: [{ measurements: ["m1"] }],
    },
    nonce: "n1",
    expectedArch: "HOPPER",
    expectedDeviceCertHash: "hash",
  expectedRimHash: "rim",
  expectedUeid: "ueid",
  expectedMeasurements: ["m1"],
};

const clonePayload = () => JSON.parse(JSON.stringify(basePayload));

  it("logs telemetry when JWT verification fails", async () => {
    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      // NRAS POST response with JWT
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([["JWT", token]]),
      })
      // JWKS
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ kid: "kid1", kty: "EC" }] }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);
    vi.spyOn(crypto, "createPublicKey").mockReturnValue({} as any);
    vi.spyOn(crypto, "verify").mockReturnValue(false as any);

    const { req, res, state } = mockReqRes(clonePayload());
    await handler(req, res);

    expect(state.status).toBe(500);
    expect(state.body?.error).toBe("Failed to reach NRAS");
    expect(errorSpy).toHaveBeenCalledWith(
      "[NRAS] JWT verification failed:",
      expect.any(Error),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[NRAS]",
      "NRAS error",
      expect.objectContaining({ message: expect.stringContaining("JWT signature verification failed") }),
    );
  });

  it("logs telemetry on nonce mismatch", async () => {
    const token = makeJwt({ nonce: "wrong-nonce" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([["JWT", token]]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ kid: "kid1", kty: "EC" }] }),
      });

    vi.stubGlobal("fetch", fetchSpy as any);
    vi.spyOn(crypto, "createPublicKey").mockReturnValue({} as any);
    vi.spyOn(crypto, "verify").mockReturnValue(true as any);

    const { req, res, state } = mockReqRes(clonePayload());
    await handler(req, res);

    expect(state.status).toBeGreaterThanOrEqual(500);
    const logCount =
      logSpy.mock.calls.length + warnSpy.mock.calls.length + errorSpy.mock.calls.length;
    expect(logCount).toBeGreaterThan(0);
  });

  it("logs telemetry on network failure", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchSpy as any);

    const { req, res, state } = mockReqRes(clonePayload());
    await handler(req, res);

    expect(state.status).toBe(500);
    expect(state.body?.details).toContain("network");
    expect(warnSpy).toHaveBeenCalledWith(
      "[NRAS]",
      "NRAS error",
      expect.objectContaining({ message: "network" }),
    );
  });

  it("logs telemetry when JWKS fetch fails", async () => {
    const token = makeJwt({ nonce: "n1" });
    const fetchSpy = vi
      .fn()
      // NRAS POST
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([["JWT", token]]),
      })
      // JWKS failure
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    vi.stubGlobal("fetch", fetchSpy as any);
    vi.spyOn(crypto, "createPublicKey").mockReturnValue({} as any);
    vi.spyOn(crypto, "verify").mockReturnValue(true as any);

    const { req, res, state } = mockReqRes(clonePayload());
    await handler(req, res);

    expect(state.status).toBe(500);
    expect(warnSpy).toHaveBeenCalledWith(
      "[NRAS]",
      "NRAS error",
      expect.objectContaining({ message: expect.stringContaining("Failed to fetch NRAS JWKS") }),
    );
  });
});
