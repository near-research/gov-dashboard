import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

const mockClient = {
  createSession: vi.fn(),
  getSession: vi.fn(),
  updateSessionHashes: vi.fn(),
  verify: vi.fn(),
  verifyWithNras: vi.fn(),
};

const rateLimitCheck = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/near-ai", () => ({
  getNearAIClient: () => mockClient,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({
    check: rateLimitCheck,
  }),
}));

type MockState = {
  status: number;
  body: any;
};

const createMockReqRes = (body: any = {}) => {
  const req = {
    method: "POST",
    body,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
  const state: MockState = { status: 200, body: null };
  const res = {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(payload: any) {
      state.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
    _getStatusCode() {
      return state.status;
    },
    _getData() {
      return JSON.stringify(state.body);
    },
  } as unknown as NextApiResponse & {
    _getStatusCode(): number;
    _getData(): string;
  };
  return { req, res, state };
};

describe("verification API handlers", () => {
beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCheck.mockReset();
    rateLimitCheck.mockResolvedValue(undefined);
  });

  describe("POST /api/verification/session", () => {
    it("creates session and returns nonce", async () => {
      mockClient.createSession.mockReturnValue({
        nonce: "test-nonce",
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      });

      const { req, res } = createMockReqRes({ verificationId: "test-id" });
      const handler = (await import("@/pages/api/verification/session")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData())).toMatchObject({
        verificationId: "test-id",
        nonce: "test-nonce",
      });
    });

    it("returns 400 when verificationId missing", async () => {
      const { req, res } = createMockReqRes({});
      const handler = (await import("@/pages/api/verification/session")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
    });
    
    it("returns 405 for GET request", async () => {
      const { req, res } = createMockReqRes({ verificationId: "test-id" });
      req.method = "GET";

      const handler = (await import("@/pages/api/verification/session")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(405);
    });

    it("returns 429 when rate limited", async () => {
      rateLimitCheck.mockRejectedValueOnce(new Error("Rate limit"));

      const { req, res } = createMockReqRes({ verificationId: "test-id" });
      const handler = (await import("@/pages/api/verification/session")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(429);
    });

    it("returns 500 when createSession throws", async () => {
      mockClient.createSession.mockImplementation(() => {
        throw new Error("Session creation failed");
      });

      const { req, res } = createMockReqRes({ verificationId: "test-id" });
      const handler = (await import("@/pages/api/verification/session")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(500);
    });
  });

  describe("POST /api/verification/proof", () => {
    it("returns verification result", async () => {
      mockClient.getSession.mockReturnValue({ nonce: "test-nonce" });
      mockClient.verify.mockResolvedValue({
        verified: true,
        reasons: [],
        nras: { verified: true },
      });

      const { req, res } = createMockReqRes({
        verificationId: "test-id",
        model: "test-model",
      });
      const handler = (await import("@/pages/api/verification/proof")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData())).toMatchObject({ verified: true });
    });

    it("returns 400 when session not found", async () => {
      mockClient.getSession.mockReturnValue(null);

      const { req, res } = createMockReqRes({ verificationId: "non-existent" });
      const handler = (await import("@/pages/api/verification/proof")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
    });

    it("returns 405 for GET request", async () => {
      const { req, res } = createMockReqRes({ verificationId: "test-id" });
      req.method = "GET";

      const handler = (await import("@/pages/api/verification/proof")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(405);
    });

    it("returns 400 when requestHash conflicts with session", async () => {
      mockClient.getSession.mockReturnValue({
        nonce: "test-nonce",
        requestHash: "stored-hash",
      });

      const { req, res } = createMockReqRes({
        verificationId: "test-id",
        requestHash: "different-hash",
      });
      const handler = (await import("@/pages/api/verification/proof")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData()).error).toMatch(/conflict/i);
    });

    it("returns 400 when responseHash conflicts with session", async () => {
      mockClient.getSession.mockReturnValue({
        nonce: "test-nonce",
        responseHash: "stored-hash",
      });

      const { req, res } = createMockReqRes({
        verificationId: "test-id",
        responseHash: "different-hash",
      });
      const handler = (await import("@/pages/api/verification/proof")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData()).error).toMatch(/conflict/i);
    });

    it("returns 500 when verify() throws", async () => {
      mockClient.getSession.mockReturnValue({ nonce: "test-nonce" });
      mockClient.verify.mockRejectedValue(new Error("Network error"));

      const { req, res } = createMockReqRes({
        verificationId: "test-id",
        model: "test-model",
      });
      const handler = (await import("@/pages/api/verification/proof")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(500);
      expect(JSON.parse(res._getData()).error).toMatch(/failed/i);
    });
  });

  describe("POST /api/verification/nras", () => {
    it("returns NRAS verification result with claims", async () => {
      mockClient.verifyWithNras.mockResolvedValue({
        verified: true,
        reasons: [],
        claims: { attested: true },
      });

      const { req, res } = createMockReqRes({
        attestation: { nvidia_payload: {} },
        nonce: "test",
      });
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData())).toMatchObject({
        verified: true,
        claims: { attested: true },
      });
    });

    it("returns 400 when attestation missing", async () => {
      const { req, res } = createMockReqRes({});
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData()).error).toMatch(/attestation/i);
    });

    it("returns 400 when nvidia_payload missing", async () => {
      const { req, res } = createMockReqRes({
        attestation: { foo: "bar" },
        nonce: "test",
      });
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData()).error).toMatch(/nvidia_payload/i);
    });

    it("returns 400 when nonce missing", async () => {
      const { req, res } = createMockReqRes({
        attestation: { nvidia_payload: {} },
      });
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData()).error).toMatch(/nonce/i);
    });

    it("returns 400 when nonce invalid", async () => {
      const { req, res } = createMockReqRes({
        attestation: { nvidia_payload: {} },
        nonce: "",
      });
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData()).error).toMatch(/nonce/i);
    });

    it("returns 405 for GET request", async () => {
      const { req, res } = createMockReqRes({
        attestation: { nvidia_payload: {} },
        nonce: "test",
      });
      req.method = "GET";

      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(405);
    });

    it("returns verified:false when verification fails", async () => {
      mockClient.verifyWithNras.mockResolvedValue({
        verified: false,
        reasons: ["NRAS rejected payload"],
      });

      const { req, res } = createMockReqRes({
        attestation: { nvidia_payload: {} },
        nonce: "test",
      });
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData())).toMatchObject({
        verified: false,
        reasons: ["NRAS rejected payload"],
      });
    });

    it("returns 502 when verifyWithNras throws network error", async () => {
      mockClient.verifyWithNras.mockRejectedValue(new Error("Network failure"));

      const { req, res } = createMockReqRes({
        attestation: { nvidia_payload: {} },
        nonce: "test",
      });
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(502);
      expect(JSON.parse(res._getData()).error).toBe("NRAS service unavailable");
    });

    it("returns 500 when verifyWithNras throws unexpected error", async () => {
      mockClient.verifyWithNras.mockRejectedValue(new Error("Unexpected boom"));

      const { req, res } = createMockReqRes({
        attestation: { nvidia_payload: {} },
        nonce: "test",
      });
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(500);
      expect(JSON.parse(res._getData()).error).toBe("Internal server error");
    });
  });
});
