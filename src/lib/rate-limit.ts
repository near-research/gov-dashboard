import type { NextApiResponse } from "next";

export interface RateLimitOptions {
  interval: number;
  uniqueTokenPerInterval: number;
}

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

class RateLimitExceededError extends Error {
  retryAfter: number;

  constructor(retryAfter: number) {
    super("Rate limit exceeded");
    this.retryAfter = retryAfter;
  }
}

function setRateLimitHeaders(
  res: NextApiResponse,
  limit: number,
  remaining: number,
  resetSeconds: number
) {
  res.setHeader("X-RateLimit-Limit", limit.toString());
  res.setHeader("X-RateLimit-Remaining", remaining.toString());
  res.setHeader("X-RateLimit-Reset", resetSeconds.toString());
}

export function rateLimit(options: RateLimitOptions) {
  const store = new Map<string, RateLimitRecord>();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }, options.interval);

  if (typeof cleanupInterval.unref === "function") {
    cleanupInterval.unref();
  }

  const pruneExpired = (now: number) => {
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  };

  const ensureCapacity = () => {
    if (store.size <= options.uniqueTokenPerInterval) return;
    const iterator = store.keys();
    while (store.size > options.uniqueTokenPerInterval) {
      const key = iterator.next().value as string | undefined;
      if (!key) break;
      store.delete(key);
    }
  };

  const check = async (
    res: NextApiResponse,
    limit: number,
    token: string
  ) => {
    const now = Date.now();
    pruneExpired(now);

    let record = store.get(token);
    if (!record || now > record.resetTime) {
      record = {
        count: 0,
        resetTime: now + options.interval,
      };
      store.set(token, record);
      ensureCapacity();
    }

    if (record.count >= limit) {
      const retryAfterSeconds = Math.max(
        0,
        Math.ceil((record.resetTime - now) / 1000)
      );
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      setRateLimitHeaders(res, limit, 0, retryAfterSeconds);
      throw new RateLimitExceededError(retryAfterSeconds);
    }

    record.count += 1;
    const remaining = Math.max(limit - record.count, 0);
    const resetSeconds = Math.max(
      0,
      Math.ceil((record.resetTime - now) / 1000)
    );
    setRateLimitHeaders(res, limit, remaining, resetSeconds);
  };

  return {
    check,
  };
}

export { RateLimitExceededError };
