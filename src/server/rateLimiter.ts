import type { NextApiRequest } from "next";

type RateLimitRecord = {
  count: number;
  resetTime: number;
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export interface RateLimiter {
  check: (key: string) => RateLimitResult;
  limit: number;
  windowMs: number;
}

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  cleanupIntervalMs?: number;
}

/**
 * Creates an in-memory rate limiter with sliding windows.
 * Each instance maintains its own store keyed by arbitrary identifiers
 * (e.g., NEAR accounts or client IPs).
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const store = new Map<string, RateLimitRecord>();
  const cleanupInterval = options.cleanupIntervalMs ?? 60_000;

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }, cleanupInterval);

  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  const check = (key: string): RateLimitResult => {
    const now = Date.now();
    const record = store.get(key);

    if (!record || now > record.resetTime) {
      const resetTime = now + options.windowMs;
      store.set(key, { count: 1, resetTime });
      return {
        allowed: true,
        remaining: options.maxRequests - 1,
        resetTime,
      };
    }

    if (record.count >= options.maxRequests) {
      return { allowed: false, remaining: 0, resetTime: record.resetTime };
    }

    record.count += 1;
    return {
      allowed: true,
      remaining: options.maxRequests - record.count,
      resetTime: record.resetTime,
    };
  };

  return {
    check,
    limit: options.maxRequests,
    windowMs: options.windowMs,
  };
}

/**
 * Derives a client identifier for rate limiting, attempting to honor proxy
 * headers before falling back to the socket address.
 */
export function getClientIdentifier(req: NextApiRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const realIp = req.headers["x-real-ip"];

  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (typeof realIp === "string") {
    return realIp;
  }
  return req.socket.remoteAddress || "unknown";
}
