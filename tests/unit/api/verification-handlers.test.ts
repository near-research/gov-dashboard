import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

const mockClient = {
  createSession: vi.fn(),
  getSession: vi.fn(),
  updateSessionHashes: vi.fn(),
  verify: vi.fn(),
  verifyWithNras: vi.fn(),
};

vi.mock("@/lib/near-ai", () => ({
  getNearAIClient: () => mockClient,
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
  });

  describe("POST /api/verification/nras", () => {
    it("returns NRAS verification result", async () => {
      mockClient.verifyWithNras.mockResolvedValue({
        verified: true,
        reasons: [],
      });

      const { req, res } = createMockReqRes({
        attestation: { nvidia_payload: {} },
        nonce: "test",
      });
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData())).toMatchObject({ verified: true });
    });

    it("returns 400 when attestation missing", async () => {
      const { req, res } = createMockReqRes({});
      const handler = (await import("@/pages/api/verification/nras")).default;
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
    });
  });
});
