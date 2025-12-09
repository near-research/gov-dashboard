import type { NextApiRequest } from "next";
import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";

describe("createRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enforces the max requests per sliding window", () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = createRateLimiter({
      windowMs: 1000,
      maxRequests: 2,
      cleanupIntervalMs: 500,
    });

    const first = limiter.check("client-1");
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);

    const second = limiter.check("client-1");
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);

    const third = limiter.check("client-1");
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("resets counts once the window expires", () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = createRateLimiter({
      windowMs: 1000,
      maxRequests: 1,
      cleanupIntervalMs: 500,
    });

    limiter.check("client-2");
    vi.advanceTimersByTime(1001);

    const afterWindow = limiter.check("client-2");
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(0);
  });
});

describe("getClientIdentifier", () => {
  const baseRequest = {
    headers: {},
    socket: { remoteAddress: "10.0.0.1" } as any,
  } as unknown as NextApiRequest;

  it("prefers the x-forwarded-for header", () => {
    const request = {
      ...baseRequest,
      headers: {
        "x-forwarded-for": "203.0.113.5, 198.51.100.7",
        "x-real-ip": "198.51.100.8",
      },
    } as unknown as NextApiRequest;

    expect(getClientIdentifier(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip and then the socket address", () => {
    const realIpRequest = {
      ...baseRequest,
      headers: {
        "x-real-ip": "198.51.100.9",
      },
    } as unknown as NextApiRequest;

    const fallbackRequest = {
      ...baseRequest,
      headers: {},
    } as unknown as NextApiRequest;

    expect(getClientIdentifier(realIpRequest)).toBe("198.51.100.9");
    expect(getClientIdentifier(fallbackRequest)).toBe("10.0.0.1");
  });
});
