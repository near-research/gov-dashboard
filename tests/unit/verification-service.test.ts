import "../vi-compat";
import { describe, it, expect, vi, afterEach } from "vitest";
import { verificationService } from "@/verification/server/service";

const originalFetch = globalThis.fetch;

describe("verificationService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("returns null and warns when NEAR AI API key is missing", async () => {
    vi.stubEnv("NEAR_AI_CLOUD_API_KEY", "");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await verificationService.finalizeStage({
      verificationId: "verification-1",
      remoteMessageId: "msg-1",
      nonce: "nonce-1",
      model: "gpt-oss-120b",
      stage: "initial_reasoning",
    });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[verificationService] NEAR_AI_CLOUD_API_KEY missing; skipping signature fetch"
    );
  });

  it("logs and returns null when signature fetch responses are non-OK", async () => {
    vi.stubEnv("NEAR_AI_CLOUD_API_KEY", "test-key");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () =>
      ({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as unknown as Response)
    );
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;

    const result = await verificationService.finalizeStage({
      verificationId: "verification-2",
      remoteMessageId: "msg-2",
      nonce: "nonce-2",
      model: "gpt-oss-120b",
      stage: "initial_reasoning",
    });

    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to fetch signature for hash extraction")
    );
  });
});
