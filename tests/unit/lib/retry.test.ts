import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { waitForBackoff } from "@/lib/auth/retry";

describe("waitForBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(global, "setTimeout");
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves immediately when base delay is zero", async () => {
    const promise = waitForBackoff(0, 0);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
    vi.advanceTimersByTime(0);
    await expect(promise).resolves.toBeUndefined();
  });

  it("delays by the exponential value for the given attempt", async () => {
    const attempt = 2;
    const promise = waitForBackoff(attempt);
    const expectedDelay = 250 * Math.pow(2, attempt);

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), expectedDelay);
    vi.advanceTimersByTime(expectedDelay);
    await expect(promise).resolves.toBeUndefined();
  });

  it("caps the delay at the max value across repeated retries", async () => {
    const promise = waitForBackoff(5); // would normally be 250 * 32 = 8000 but capped at 2000

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);
    vi.advanceTimersByTime(2000);
    await expect(promise).resolves.toBeUndefined();
  });
});
