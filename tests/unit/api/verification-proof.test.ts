import { describe, it, expect, beforeEach, vi } from "vitest";

import handler from "@/pages/api/verification/proof";
import { sessionsCache } from "@/pages/api/verification/session";

const createMockReq = (
  overrides: Partial<{ method?: string; body?: unknown }> = {}
) => ({
  method: "POST",
  body: {},
  ...overrides,
});

const createMockRes = () => {
  const res: Record<string, any> = {};
  res.setHeader = vi.fn();
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("/api/verification/proof", () => {
  beforeEach(() => {
    sessionsCache.clear();
  });

  it("returns 405 for non-POST requests", async () => {
    const req = createMockReq({ method: "GET" });
    const res = createMockRes();

    await handler(req as any, res as any);

    expect(res.setHeader).toHaveBeenCalledWith("Allow", "POST");
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("returns 400 when verificationId is missing", async () => {
    const req = createMockReq({ body: {} });
    const res = createMockRes();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when session is missing", async () => {
    const req = createMockReq({ body: { verificationId: "missing" } });
    const res = createMockRes();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns proof data when session exists", async () => {
    const verificationId = "proof-id";
    const session = {
      nonce: "abc123",
      requestHash: "req-hash",
      responseHash: "res-hash",
      createdAt: Date.now(),
      expiresAt: Date.now() + 1_000,
    };

    sessionsCache.set(verificationId, session);

    const req = createMockReq({
      body: { verificationId },
    });
    const res = createMockRes();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      verificationId,
      nonce: session.nonce,
      requestHash: session.requestHash,
      responseHash: session.responseHash,
      verified: true,
    });
  });
});
