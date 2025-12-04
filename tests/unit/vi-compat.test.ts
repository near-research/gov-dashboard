import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../vi-compat";

describe("vi-compat shims", () => {
  beforeEach(() => {
    vi.unstubAllGlobals?.();
  });

  afterEach(() => {
    vi.unstubAllGlobals?.();
    vi.restoreAllMocks();
  });

  it("restores stubbed globals via unstubAllGlobals", () => {
    expect((globalThis as any).__viCompatTest).toBeUndefined();

    vi.stubGlobal("__viCompatTest", "value");
    expect((globalThis as any).__viCompatTest).toBe("value");

    vi.unstubAllGlobals?.();
    expect((globalThis as any).__viCompatTest).toBeUndefined();
  });

  it("ignores restore errors so they do not break test runs", () => {
    const stub = vi.stubGlobal("__viCompatError", "value") as { restore?: () => void } | undefined;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    stub && (stub.restore = vi.fn(() => {
      throw new Error("restore-failed");
    }));

    vi.unstubAllGlobals?.();

    expect(consoleSpy).toHaveBeenCalledWith(
      "[vi-compat] Failed to restore global stub:",
      expect.any(Error),
    );
    expect((globalThis as any).__viCompatError).toBeUndefined();
  });

  it("provides resetModules shim that clears vi mocks", () => {
    const originalResetAllMocks = vi.resetAllMocks;
    const originalClearAllMocks = vi.clearAllMocks;
    const resetAllMocksSpy = vi.fn();
    const clearAllMocksSpy = vi.fn();
    (vi as any).resetAllMocks = resetAllMocksSpy;
    (vi as any).clearAllMocks = clearAllMocksSpy;

    try {
      vi.resetModules?.();
    } finally {
      (vi as any).resetAllMocks = originalResetAllMocks;
      (vi as any).clearAllMocks = originalClearAllMocks;
    }

    expect(resetAllMocksSpy).toHaveBeenCalled();
    expect(clearAllMocksSpy).toHaveBeenCalled();
  });
});
