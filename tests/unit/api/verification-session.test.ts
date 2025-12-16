import { describe, it, expect, vi, type Mock } from "vitest";
import handler from "@/pages/api/verification/session";

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

describe("/api/verification/session", () => {
  const SESSION_TTL_MS = 5 * 60 * 1000;
  const getSessionPayload = (res: ReturnType<typeof createMockRes>) =>
    (res.json as Mock).mock.calls[0][0];

  afterEach(() => {
    vi.useRealTimers();
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

  it("returns session data for valid request", async () => {
    const req = createMockReq({
      body: { verificationId: "msg-123" },
    });
    const res = createMockRes();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationId: "msg-123",
        nonce: expect.any(String),
        expiresAt: expect.any(Number),
        createdAt: expect.any(Number),
      })
    );
  });

  it("returns the same nonce for repeated POSTs before TTL expires", async () => {
    const verificationId = "repeat-nonce";
    const firstReq = createMockReq({
      body: { verificationId },
    });
    const firstRes = createMockRes();

    await handler(firstReq as any, firstRes as any);

    const firstSession = getSessionPayload(firstRes);
    expect(firstRes.status).toHaveBeenCalledWith(200);

    const secondReq = createMockReq({
      body: { verificationId },
    });
    const secondRes = createMockRes();

    await handler(secondReq as any, secondRes as any);

    const secondSession = getSessionPayload(secondRes);
    expect(secondSession.nonce).toBe(firstSession.nonce);
    expect(secondSession.createdAt).toBe(firstSession.createdAt);
    expect(secondSession.expiresAt).toBeGreaterThanOrEqual(firstSession.expiresAt);
  });

  it("generates a new nonce after the session expires", async () => {
    const verificationId = "expired-session";
    vi.useFakeTimers();
    const startTime = 1_000_000;
    vi.setSystemTime(startTime);

    const initialReq = createMockReq({
      body: { verificationId },
    });
    const initialRes = createMockRes();

    await handler(initialReq as any, initialRes as any);

    const initialSession = getSessionPayload(initialRes);
    const initialNonce = initialSession.nonce;

    vi.advanceTimersByTime(SESSION_TTL_MS + 1);
    vi.setSystemTime(startTime + SESSION_TTL_MS + 1);

    const renewedReq = createMockReq({
      body: { verificationId },
    });
    const renewedRes = createMockRes();

    await handler(renewedReq as any, renewedRes as any);

    const renewedSession = getSessionPayload(renewedRes);
    expect(renewedSession.nonce).not.toBe(initialNonce);
    expect(renewedSession.createdAt).toBeGreaterThan(initialSession.createdAt);
  });

  it("applies overrides from the request body", async () => {
    const verificationId = "override-session";
    const overrides = {
      nonce: "0".repeat(64),
      requestHash: "custom-request-hash",
      responseHash: "custom-response-hash",
    };
    const req = createMockReq({
      body: {
        verificationId,
        ...overrides,
      },
    });
    const res = createMockRes();

    await handler(req as any, res as any);

    const session = getSessionPayload(res);
    expect(session.nonce).toBe(overrides.nonce);
    expect(session.requestHash).toBe(overrides.requestHash);
    expect(session.responseHash).toBe(overrides.responseHash);
  });

  it("stores the attestedNonce and returns it on subsequent requests", async () => {
    const verificationId = "attested-session";
    const attestedNonce = "f".repeat(64);
    const attestedReq = createMockReq({
      body: {
        verificationId,
        attestedNonce,
      },
    });
    const attestedRes = createMockRes();

    await handler(attestedReq as any, attestedRes as any);

    const attestedSession = getSessionPayload(attestedRes);
    expect(attestedSession.nonce).toBe(attestedNonce);

    const followUpRes = createMockRes();
    const followUpReq = createMockReq({
      body: { verificationId },
    });

    await handler(followUpReq as any, followUpRes as any);

    const followUpSession = getSessionPayload(followUpRes);
    expect(followUpSession.nonce).toBe(attestedNonce);
    expect(followUpSession.createdAt).toBe(attestedSession.createdAt);
  });
});
