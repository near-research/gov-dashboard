import { describe, expect, it, vi } from "vitest";
import { SimpleCache } from "@/utils/cache-utils";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("SimpleCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires entries after the TTL elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const cache = new SimpleCache<string>(0.001, "ttl-cache");
    cache.set("proposal:1", "fresh");

    expect(cache.get("proposal:1")).toBe("fresh");

    vi.advanceTimersByTime(59);
    expect(cache.get("proposal:1")).toBe("fresh");

    vi.advanceTimersByTime(2);
    expect(cache.get("proposal:1")).toBeNull();
  });

  it("invalidates entries via explicit keys, patterns, and clear", () => {
    const cache = new SimpleCache<string>(5, "invalidate-cache");
    cache.set("discussion:123", "A");
    cache.set("discussion:456", "B");
    cache.set("reply:999", "C");

    expect(cache.has("discussion:123")).toBe(true);
    expect(cache.invalidate("discussion:123")).toBe(true);
    expect(cache.has("discussion:123")).toBe(false);

    const removed = cache.invalidatePattern("^discussion");
    expect(removed).toBe(1);
    expect(cache.has("discussion:456")).toBe(false);
    expect(cache.has("reply:999")).toBe(true);

    cache.clear();
    expect(cache.getStats().totalEntries).toBe(0);
  });

  it("handles concurrent getOrSet callers without corruption", async () => {
    const cache = new SimpleCache<string>(10, "concurrent-cache");
    const deferred = createDeferred<string>();
    const factory = vi.fn(() => deferred.promise);

    const promiseA = cache.getOrSet("proposal:concurrent", factory);
    const promiseB = cache.getOrSet("proposal:concurrent", factory);

    expect(factory).toHaveBeenCalledTimes(2);

    deferred.resolve("winner");
    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

    expect(resultA).toBe("winner");
    expect(resultB).toBe("winner");
    expect(cache.get("proposal:concurrent")).toBe("winner");
  });
});
