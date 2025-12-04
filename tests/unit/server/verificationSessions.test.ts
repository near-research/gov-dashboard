import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerVerificationSession,
  getVerificationSession,
  cleanupExpiredSessions,
  TTL_MS,
  clearVerificationSession,
} from "@/verification/server";

describe("verificationSessions", () => {
  let now = 0;
  let nowSpy: ReturnType<typeof vi.spyOn> | null = null;
  const advance = (ms: number) => {
    now += ms;
  };

  beforeEach(() => {
    now = 0;
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    // Clean slate by fast-forwarding and cleaning
    cleanupExpiredSessions();
  });

  afterEach(() => {
    nowSpy?.mockRestore();
    nowSpy = null;
  });

  it("generates unique 64-char hex nonces", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const session = registerVerificationSession(`id-${i}`);
      expect(session.nonce).toMatch(/^[0-9a-f]{64}$/);
      seen.add(session.nonce);
    }
    expect(seen.size).toBe(100);
  });

  it("expires sessions after TTL", () => {
    const session = registerVerificationSession("id-expire");
    expect(getVerificationSession("id-expire")?.nonce).toBe(session.nonce);

    // Advance just past TTL and trigger cleanup
    advance(TTL_MS + 1000);
    cleanupExpiredSessions();

    expect(getVerificationSession("id-expire")).toBeNull();
  });

  it("retains sessions before TTL", () => {
    const session = registerVerificationSession("id-active");
    advance(TTL_MS - 1000);
    expect(getVerificationSession("id-active")?.nonce).toBe(session.nonce);
    clearVerificationSession("id-active");
  });
});
