import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proposalCache, CacheKeys } from "@/utils/cache-utils";

describe("SimpleCache TTL and cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    proposalCache.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    proposalCache.clear();
  });

  it("expires entries after TTL and cleanup removes them", () => {
    const key = CacheKeys.proposal("expire-test");
    proposalCache.set(key, { value: "one" }, 0.01); // ~0.6s TTL

    expect(proposalCache.get(key)).toEqual({ value: "one" });
    expect(proposalCache.has(key)).toBe(true);

    vi.advanceTimersByTime(700); // advance past TTL

    expect(proposalCache.get(key)).toBeNull();
    expect(proposalCache.has(key)).toBe(false);

    const key2 = CacheKeys.proposal("cleanup-test");
    proposalCache.set(key2, { value: "two" }, 0.01);
    vi.advanceTimersByTime(700);
    const removed = proposalCache.cleanup();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(proposalCache.has(key2)).toBe(false);
  });

  it("reports TTL remaining and reuses cached values via getOrSet", async () => {
    const key = CacheKeys.proposal("factory-test");

    const factory = vi.fn(async () => "fresh-value");
    const first = await proposalCache.getOrSet(key, factory, 1);
    expect(first).toBe("fresh-value");
    expect(factory).toHaveBeenCalledOnce();

    const remaining = proposalCache.ttlRemaining(key);
    expect(remaining).toBeGreaterThan(50);

    const second = await proposalCache.getOrSet(key, factory);
    expect(second).toBe("fresh-value");
    expect(factory).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(61_000);
    expect(proposalCache.ttlRemaining(key)).toBeNull();
  });

  it("invalidates pattern matches", () => {
    const prefix = "proposal:pattern-";
    for (let idx = 0; idx < 3; idx++) {
      proposalCache.set(`${prefix}${idx}`, idx);
    }
    const removed = proposalCache.invalidatePattern(`${prefix}\\d`);
    expect(removed).toBe(3);
    expect(proposalCache.has(`${prefix}0`)).toBe(false);
  });
});
