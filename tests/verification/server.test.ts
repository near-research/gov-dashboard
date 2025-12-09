import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";

// ============================================================================
// Tests for src/verification/server/normalize.ts
// ============================================================================

describe("src/verification/server/normalize.ts", () => {
  let mockBaseNormalize: ReturnType<typeof vi.fn>;
  let mockRegisterSession: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).navigator;

    mockBaseNormalize = vi.fn();

    vi.doMock("@/verification/normalize", () => ({
      normalizeVerificationPayload: mockBaseNormalize,
    }));

    const sessionsModuleMock = (await vi.importActual(
      "@/verification/server/sessions"
    )) as typeof import("@/verification/server/sessions");
    mockRegisterSession = vi.spyOn(
      sessionsModuleMock,
      "registerVerificationSession"
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("normalizeVerificationPayload (server)", () => {
    it("should register session and add nonce when on server with verificationId", async () => {

      mockBaseNormalize.mockReturnValue({
        verification: {
          source: "near-ai-cloud",
          status: "pending",
          messageId: "msg-123",
        },
        verificationId: "ver-123",
      });

      mockRegisterSession.mockReturnValue({
        nonce: "generated-nonce-hex64",
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      });

      const { normalizeVerificationPayload } = await import(
        "@/verification/server/normalize"
      );

      const result = normalizeVerificationPayload(
        { source: "near-ai-cloud", status: "pending", messageId: "msg-123" },
        "ver-123"
      );

      expect(mockRegisterSession).toHaveBeenCalledWith("ver-123");
      expect(result.verification?.nonce).toBe("generated-nonce-hex64");
      expect(result.verificationId).toBe("ver-123");
    });

    it("should not override existing nonce in verification metadata", async () => {

      mockBaseNormalize.mockReturnValue({
        verification: {
          source: "near-ai-cloud",
          status: "pending",
          messageId: "msg-123",
          nonce: "existing-nonce",
        },
        verificationId: "ver-123",
      });

      mockRegisterSession.mockReturnValue({
        nonce: "new-nonce",
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      });

      const { normalizeVerificationPayload } = await import(
        "@/verification/server/normalize"
      );

      const result = normalizeVerificationPayload(
        {
          source: "near-ai-cloud",
          status: "pending",
          messageId: "msg-123",
          nonce: "existing-nonce",
        },
        "ver-123"
      );

      expect(result.verification?.nonce).toBe("existing-nonce");
    });

    it("should skip session registration in browser environment", async () => {
      vi.stubGlobal("window", {} as Window & typeof globalThis);

      mockBaseNormalize.mockReturnValue({
        verification: {
          source: "near-ai-cloud",
          status: "pending",
          messageId: "msg-123",
        },
        verificationId: "ver-123",
      });

      const { normalizeVerificationPayload } = await import(
        "@/verification/server/normalize"
      );

      const result = normalizeVerificationPayload(null, "ver-123");

      expect(mockRegisterSession).not.toHaveBeenCalled();
      expect(result.verificationId).toBe("ver-123");
    });

    it("should skip session registration when verificationId is null", async () => {

      mockBaseNormalize.mockReturnValue({
        verification: undefined,
        verificationId: null,
      });

      const { normalizeVerificationPayload } = await import(
        "@/verification/server/normalize"
      );

      const result = normalizeVerificationPayload(null, null);

      expect(mockRegisterSession).not.toHaveBeenCalled();
      expect(result.verificationId).toBeNull();
    });

    it("should handle session registration errors gracefully", async () => {

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockBaseNormalize.mockReturnValue({
        verification: {
          source: "near-ai-cloud",
          status: "pending",
          messageId: "msg-123",
        },
        verificationId: "ver-123",
      });

      mockRegisterSession.mockImplementation(() => {
        throw new Error("Session store unavailable");
      });

      const { normalizeVerificationPayload } = await import(
        "@/verification/server/normalize"
      );

      const result = normalizeVerificationPayload(null, "ver-123");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Unable to register verification session:",
        expect.any(Error)
      );
      expect(result.verificationId).toBe("ver-123");

      consoleErrorSpy.mockRestore();
    });

    it("should return normalized verification without nonce when normalized is null", async () => {

      mockBaseNormalize.mockReturnValue({
        verification: null,
        verificationId: "ver-123",
      });

      mockRegisterSession.mockReturnValue({
        nonce: "generated-nonce",
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      });

      const { normalizeVerificationPayload } = await import(
        "@/verification/server/normalize"
      );

      const result = normalizeVerificationPayload(null, "ver-123");

      expect(result.verification).toBeNull();
    });
  });
});

// ============================================================================
// Tests for src/verification/server/sessions.ts
// ============================================================================

describe("src/verification/server/sessions.ts", () => {
  let sessionsModule: typeof import("@/verification/server/sessions");

  beforeEach(async () => {
    vi.resetModules();

    const g = globalThis as any;
    delete g.__verificationSessions;
    delete g.__verificationSessionNotFoundMetrics;

    sessionsModule = await import("@/verification/server/sessions");
  });

  describe("registerVerificationSession", () => {
    it("should create a new session with generated nonce", () => {
      const session = sessionsModule.registerVerificationSession("ver-new");

      expect(session.nonce).toMatch(/^[0-9a-f]{64}$/i);
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
      expect(session.expiresAt).toBeGreaterThan(Date.now());
      expect(session.requestHash).toBeNull();
      expect(session.responseHash).toBeNull();
    });

    it("should use provided valid hex64 nonce", () => {
      const validNonce = "a".repeat(64);
      const session = sessionsModule.registerVerificationSession("ver-123", validNonce);

      expect(session.nonce).toBe(validNonce);
    });

    it("should generate new nonce for invalid nonce format", () => {
      const invalidNonce = "not-a-valid-hex64";
      const session = sessionsModule.registerVerificationSession("ver-123", invalidNonce);

      expect(session.nonce).not.toBe(invalidNonce);
      expect(session.nonce).toMatch(/^[0-9a-f]{64}$/i);
    });

    it("should merge with existing session and preserve original nonce", () => {
      const firstSession = sessionsModule.registerVerificationSession("ver-123");
      const originalNonce = firstSession.nonce;

      const secondSession = sessionsModule.registerVerificationSession(
        "ver-123",
        "b".repeat(64),
        "new-req-hash",
        "new-res-hash"
      );

      expect(secondSession.nonce).toBe(originalNonce);
      expect(secondSession.requestHash).toBe("new-req-hash");
      expect(secondSession.responseHash).toBe("new-res-hash");
    });

    it("should preserve existing hashes when merging", () => {
      sessionsModule.registerVerificationSession("ver-123", undefined, "original-req", "original-res");

      const merged = sessionsModule.registerVerificationSession("ver-123", undefined, null, null);

      expect(merged.requestHash).toBe("original-req");
      expect(merged.responseHash).toBe("original-res");
    });

    it("should store initial hashes", () => {
      const session = sessionsModule.registerVerificationSession("ver-123", undefined, "req-hash", "res-hash");

      expect(session.requestHash).toBe("req-hash");
      expect(session.responseHash).toBe("res-hash");
    });
  });

  describe("getVerificationSession", () => {
    it("should return null for non-existent session", () => {
      const session = sessionsModule.getVerificationSession("non-existent");
      expect(session).toBeNull();
    });

    it("should return session that exists and is not expired", () => {
      sessionsModule.registerVerificationSession("ver-123");
      const session = sessionsModule.getVerificationSession("ver-123");

      expect(session).not.toBeNull();
      expect(session?.nonce).toMatch(/^[0-9a-f]{64}$/i);
    });

    it("should return null for expired session", () => {
      sessionsModule.registerVerificationSession("ver-expired");

      const g = globalThis as any;
      const sessions = g.__verificationSessions as Map<string, any>;
      const existing = sessions.get("ver-expired");
      sessions.set("ver-expired", { ...existing, expiresAt: Date.now() - 1000 });

      const session = sessionsModule.getVerificationSession("ver-expired");
      expect(session).toBeNull();
    });

    it("should record metrics for missing sessions", () => {
      sessionsModule.resetVerificationSessionNotFoundMetrics();

      sessionsModule.getVerificationSession("missing-1");
      sessionsModule.getVerificationSession("missing-2");

      const metrics = sessionsModule.getVerificationSessionNotFoundMetrics();
      expect(metrics?.count).toBe(2);
      expect(metrics?.lastVerificationId).toBe("missing-2");
    });

    it("should record metrics for expired sessions", () => {
      sessionsModule.resetVerificationSessionNotFoundMetrics();

      sessionsModule.registerVerificationSession("ver-expired");
      const g = globalThis as any;
      const sessions = g.__verificationSessions as Map<string, any>;
      const existing = sessions.get("ver-expired");
      sessions.set("ver-expired", { ...existing, expiresAt: Date.now() - 1000 });

      sessionsModule.resetVerificationSessionNotFoundMetrics();

      sessionsModule.getVerificationSession("ver-expired");

      const metrics = sessionsModule.getVerificationSessionNotFoundMetrics();
      expect(metrics?.count).toBe(1);
    });
  });

  describe("updateVerificationHashes", () => {
    it("should update hashes for existing session", () => {
      sessionsModule.registerVerificationSession("ver-123");

      sessionsModule.updateVerificationHashes("ver-123", {
        requestHash: "updated-req",
        responseHash: "updated-res",
      });

      const session = sessionsModule.getVerificationSession("ver-123");
      expect(session?.requestHash).toBe("updated-req");
      expect(session?.responseHash).toBe("updated-res");
    });

    it("should do nothing for non-existent session", () => {
      sessionsModule.updateVerificationHashes("non-existent", { requestHash: "hash" });

      const session = sessionsModule.getVerificationSession("non-existent");
      expect(session).toBeNull();
    });

    it("should preserve existing hash when updating only one", () => {
      sessionsModule.registerVerificationSession("ver-123", undefined, "original-req", "original-res");

      sessionsModule.updateVerificationHashes("ver-123", { requestHash: "new-req" });

      const session = sessionsModule.getVerificationSession("ver-123");
      expect(session?.requestHash).toBe("new-req");
      expect(session?.responseHash).toBe("original-res");
    });
  });

  describe("clearVerificationSession", () => {
    it("should remove session from store", () => {
      sessionsModule.registerVerificationSession("ver-to-clear");

      expect(sessionsModule.getVerificationSession("ver-to-clear")).not.toBeNull();

      sessionsModule.clearVerificationSession("ver-to-clear");

      sessionsModule.resetVerificationSessionNotFoundMetrics();

      expect(sessionsModule.getVerificationSession("ver-to-clear")).toBeNull();
    });

    it("should handle clearing non-existent session gracefully", () => {
      expect(() => sessionsModule.clearVerificationSession("non-existent")).not.toThrow();
    });
  });

  describe("syncVerificationNonce", () => {
    it("should create new session with valid nonce", () => {
      const validNonce = "c".repeat(64);
      const session = sessionsModule.syncVerificationNonce("ver-sync", validNonce, "req-hash", "res-hash");

      expect(session?.nonce).toBe(validNonce);
      expect(session?.requestHash).toBe("req-hash");
      expect(session?.responseHash).toBe("res-hash");
    });

    it("should reject invalid nonce format", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const session = sessionsModule.syncVerificationNonce("ver-sync", "invalid-nonce", "req-hash");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[verification] Rejected weak/invalid nonce override",
        expect.any(Object)
      );
      expect(session).toBeNull();

      consoleWarnSpy.mockRestore();
    });

    it("should reject nonce override for existing session with different nonce", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const originalNonce = "a".repeat(64);
      sessionsModule.registerVerificationSession("ver-sync", originalNonce);

      const newNonce = "b".repeat(64);
      const session = sessionsModule.syncVerificationNonce("ver-sync", newNonce);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[verification] Rejected nonce override attempt",
        expect.any(Object)
      );
      expect(session?.nonce).toBe(originalNonce);

      consoleWarnSpy.mockRestore();
    });

    it("should allow sync with same nonce and update hashes", () => {
      const nonce = "d".repeat(64);
      sessionsModule.registerVerificationSession("ver-sync", nonce);

      const session = sessionsModule.syncVerificationNonce("ver-sync", nonce, "new-req", "new-res");

      expect(session?.nonce).toBe(nonce);
      expect(session?.requestHash).toBe("new-req");
      expect(session?.responseHash).toBe("new-res");
    });

    it("should extend expiration time on sync", () => {
      const nonce = "e".repeat(64);
      sessionsModule.registerVerificationSession("ver-sync", nonce);

      const now = Date.now();

      const synced = sessionsModule.syncVerificationNonce("ver-sync", nonce);

      expect(synced?.expiresAt).toBeGreaterThanOrEqual(now);
    });

    it("should preserve existing hashes when sync provides null", () => {
      const nonce = "f".repeat(64);
      sessionsModule.registerVerificationSession("ver-sync", nonce, "existing-req", "existing-res");

      const session = sessionsModule.syncVerificationNonce("ver-sync", nonce, null, null);

      expect(session?.requestHash).toBe("existing-req");
      expect(session?.responseHash).toBe("existing-res");
    });

    describe("cleanupExpiredSessions", () => {
      it("should remove only expired sessions", () => {
        sessionsModule.registerVerificationSession("ver-valid");

        sessionsModule.registerVerificationSession("ver-expired");
        const g = globalThis as any;
        const sessions = g.__verificationSessions as Map<string, any>;
        const expiredSession = sessions.get("ver-expired");
        sessions.set("ver-expired", { ...expiredSession, expiresAt: Date.now() - 1000 });

        sessionsModule.cleanupExpiredSessions();

        expect(sessions.has("ver-valid")).toBe(true);
        expect(sessions.has("ver-expired")).toBe(false);
      });
    });
  });

  describe("metrics functions", () => {
    it("should return null when no metrics recorded", () => {
      sessionsModule.resetVerificationSessionNotFoundMetrics();
      const metrics = sessionsModule.getVerificationSessionNotFoundMetrics();
      expect(metrics).toBeNull();
    });

    it("should track cumulative not-found count", () => {
      sessionsModule.resetVerificationSessionNotFoundMetrics();

      for (let i = 0; i < 5; i++) {
        sessionsModule.getVerificationSession(`missing-${i}`);
      }

      const metrics = sessionsModule.getVerificationSessionNotFoundMetrics();
      expect(metrics?.count).toBe(5);
    });

    it("should reset metrics correctly", () => {
      sessionsModule.getVerificationSession("trigger-metrics");

      const beforeReset = sessionsModule.getVerificationSessionNotFoundMetrics();
      expect(beforeReset?.count).toBeGreaterThan(0);

      sessionsModule.resetVerificationSessionNotFoundMetrics();

      const afterReset = sessionsModule.getVerificationSessionNotFoundMetrics();
      expect(afterReset).toBeNull();
    });
  });

  describe("TTL_MS constant", () => {
    it("should be 5 minutes", () => {
      expect(sessionsModule.TTL_MS).toBe(5 * 60 * 1000);
    });
  });

  afterAll(() => {
    vi.unmock("@/verification/normalize");
    vi.resetModules();
  });
});

// ============================================================================
// Tests for src/verification/normalize.ts (base normalize)
// ============================================================================


describe("src/verification/normalize.ts", () => {
  describe("toVerificationStatus", () => {
    let normalizeModule: typeof import("@/verification/normalize");

    beforeEach(async () => {
      vi.resetModules();
      vi.unmock("@/verification/normalize");
      normalizeModule = await vi.importActual("@/verification/normalize");
    });

    it("should return 'verified' for verified/valid values", () => {
      expect(normalizeModule.toVerificationStatus("verified")).toBe("verified");
      expect(normalizeModule.toVerificationStatus("valid")).toBe("verified");
      expect(normalizeModule.toVerificationStatus("VERIFIED")).toBe("verified");
      expect(normalizeModule.toVerificationStatus("Valid")).toBe("verified");
    });

    it("should return 'failed' for failed/invalid values", () => {
      expect(normalizeModule.toVerificationStatus("failed")).toBe("failed");
      expect(normalizeModule.toVerificationStatus("invalid")).toBe("failed");
      expect(normalizeModule.toVerificationStatus("FAILED")).toBe("failed");
      expect(normalizeModule.toVerificationStatus("Invalid")).toBe("failed");
    });

    it("should return 'pending' for unknown values", () => {
      expect(normalizeModule.toVerificationStatus("pending")).toBe("pending");
      expect(normalizeModule.toVerificationStatus("unknown")).toBe("pending");
      expect(normalizeModule.toVerificationStatus("")).toBe("pending");
      expect(normalizeModule.toVerificationStatus(undefined)).toBe("pending");
    });
  });

  describe("shortenFingerprint", () => {
    let normalizeModule: typeof import("@/verification/normalize");

    beforeEach(async () => {
      vi.resetModules();
      vi.unmock("@/verification/normalize");
      normalizeModule = await vi.importActual("@/verification/normalize");
    });

    it("should shorten long fingerprints", () => {
      const longFingerprint = "a".repeat(64);
      const shortened = normalizeModule.shortenFingerprint(longFingerprint);
      expect(shortened).toBe("aaaaaa…aaaaaa");
    });

    it("should use custom visible length", () => {
      const fingerprint = "abcdefghijklmnop";
      const shortened = normalizeModule.shortenFingerprint(fingerprint, 3);
      expect(shortened).toBe("abc…nop");
    });

    it("should return original if already short enough", () => {
      const shortFingerprint = "abcd";
      const result = normalizeModule.shortenFingerprint(shortFingerprint, 6);
      expect(result).toBe("abcd");
    });
  });

  describe("normalizeSignaturePayload", () => {
    let normalizeModule: typeof import("@/verification/normalize");

    beforeEach(async () => {
      vi.resetModules();
      vi.unmock("@/verification/normalize");
      normalizeModule = await vi.importActual("@/verification/normalize");
    });

    it("should return null for falsy input", () => {
      expect(normalizeModule.normalizeSignaturePayload(null)).toBeNull();
      expect(normalizeModule.normalizeSignaturePayload(undefined)).toBeNull();
      expect(normalizeModule.normalizeSignaturePayload("")).toBeNull();
    });

    it("should wrap string signature", () => {
      const result = normalizeModule.normalizeSignaturePayload("sig-string");
      expect(result).toEqual({ signature: "sig-string" });
    });

    it("should return null for non-object, non-string types", () => {
      expect(normalizeModule.normalizeSignaturePayload(123)).toBeNull();
      expect(normalizeModule.normalizeSignaturePayload(true)).toBeNull();
    });

    it("should extract from object with signature field", () => {
      const result = normalizeModule.normalizeSignaturePayload({
        signature: "sig-value",
        text: "text-value",
        signing_address: "addr",
        signing_algo: "ecdsa",
      });

      expect(result).toEqual({
        signature: "sig-value",
        text: "text-value",
        signing_address: "addr",
        signing_algo: "ecdsa",
      });
    });

    it("should extract from nested data field", () => {
      const result = normalizeModule.normalizeSignaturePayload({
        data: { signature: "nested-sig", text: "nested-text" },
      });

      expect(result?.signature).toBe("nested-sig");
      expect(result?.text).toBe("nested-text");
    });

    it("should extract from nested result field", () => {
      const result = normalizeModule.normalizeSignaturePayload({
        result: { text: "result-text", signing_address: "result-addr" },
      });

      expect(result?.text).toBe("result-text");
      expect(result?.signing_address).toBe("result-addr");
    });

    it("should return null when no valid candidate found", () => {
      const result = normalizeModule.normalizeSignaturePayload({
        unrelated: "data",
        another: "field",
      });

      expect(result).toBeNull();
    });
  });

  describe("extractVerificationMetadata", () => {
    let normalizeModule: typeof import("@/verification/normalize");

    beforeEach(async () => {
      vi.resetModules();
      vi.unmock("@/verification/normalize");
      normalizeModule = await vi.importActual("@/verification/normalize");
    });

    it("should return undefined for invalid payload", () => {
      expect(normalizeModule.extractVerificationMetadata(null as any)).toBeUndefined();
      expect(normalizeModule.extractVerificationMetadata("string" as any)).toBeUndefined();
    });

    it("should create pending metadata from payload with only id", () => {
      const result = normalizeModule.extractVerificationMetadata({ id: "msg-123" });

      expect(result).toEqual({
        source: "near-ai-cloud",
        status: "pending",
        messageId: "msg-123",
      });
    });

    it("should not treat id-only payload as simple when metadata fields exist", () => {
      const result = normalizeModule.extractVerificationMetadata({
        id: "msg-123",
        verification: { status: "verified" },
      });

      expect(result?.status).toBe("verified");
    });

    it("should extract metadata from verification field", () => {
      const result = normalizeModule.extractVerificationMetadata({
        id: "msg-123",
        verification: { status: "verified", proof: "proof-data", message_id: "ver-msg-id" },
      });

      expect(result?.status).toBe("verified");
      expect(result?.proof).toBe("proof-data");
    });

    it("should extract metadata from envelope", () => {
      const result = normalizeModule.extractVerificationMetadata(
        { id: "payload-id" },
        { message_id: "envelope-msg-id", verification: { status: "valid" }, proof: "envelope-proof" }
      );

      expect(result?.messageId).toBe("envelope-msg-id");
      expect(result?.status).toBe("verified");
      expect(result?.proof).toBe("envelope-proof");
    });

    it("should extract attestation data", () => {
      const result = normalizeModule.extractVerificationMetadata({
        id: "msg-123",
        verification: { status: "pending" },
        attestation: {
          report: "attestation-report",
          measurement: "measurement-value",
          issued_at: "2024-01-01",
          url: "https://attestation.url",
        },
      });

      expect(result?.attestationReport).toBe("attestation-report");
      expect(result?.measurement).toBe("measurement-value");
      expect(result?.issuedAt).toBe("2024-01-01");
      expect(result?.attestationUrl).toBe("https://attestation.url");
    });

    it("should extract signature", () => {
      const result = normalizeModule.extractVerificationMetadata({
        id: "msg-123",
        verification: { status: "pending" },
        signature: "sig-data",
      });

      expect(result?.signature).toBe("sig-data");
    });

    it("should return undefined when no verification data present", () => {
      const result = normalizeModule.extractVerificationMetadata({ unrelated: "data" });

      expect(result).toBeUndefined();
    });

    it("should include error from metadata sources", () => {
      const result = normalizeModule.extractVerificationMetadata({
        id: "msg-123",
        verification: { status: "failed", error: "Verification failed due to timeout" },
      });

      expect(result?.error).toBe("Verification failed due to timeout");
    });
  });

  describe("normalizeVerificationPayload (base)", () => {
    let normalizeModule: typeof import("@/verification/normalize");

    beforeEach(async () => {
      vi.resetModules();
      vi.unmock("@/verification/normalize");
      normalizeModule = await vi.importActual("@/verification/normalize");
    });

    it("should use fallbackId when verification has no messageId", () => {
      const result = normalizeModule.normalizeVerificationPayload(
        { source: "near-ai-cloud", status: "pending" },
        "fallback-123"
      );

      expect(result.verificationId).toBe("fallback-123");
      expect(result.verification?.messageId).toBe("fallback-123");
    });

    it("should create pending verification from fallbackId alone", () => {
      const result = normalizeModule.normalizeVerificationPayload(null, "fallback-123");

      expect(result.verification).toEqual({
        source: "near-ai-cloud",
        status: "pending",
        messageId: "fallback-123",
      });
    });

    it("should return null verificationId when no id available", () => {
      const result = normalizeModule.normalizeVerificationPayload(null, null);

      expect(result.verificationId).toBeNull();
      expect(result.verification).toBeUndefined();
    });

    it("should preserve existing messageId over fallbackId", () => {
      const result = normalizeModule.normalizeVerificationPayload(
        { source: "near-ai-cloud", status: "verified", messageId: "existing-id" },
        "fallback-id"
      );

      expect(result.verificationId).toBe("fallback-id");
      expect(result.verification?.messageId).toBe("existing-id");
    });
  });
});

// ============================================================================
// Tests for src/verification/hash-utils.ts
// ============================================================================

describe("src/verification/hash-utils.ts", () => {
  let hashUtilsModule: typeof import("@/verification/hash-utils");

  beforeEach(async () => {
    vi.resetModules();
    hashUtilsModule = await import("@/verification/hash-utils");
  });

  describe("extractHashesFromSignedText", () => {
    it("should return null for non-string input", () => {
      expect(hashUtilsModule.extractHashesFromSignedText(null)).toBeNull();
      expect(hashUtilsModule.extractHashesFromSignedText(undefined)).toBeNull();
      expect(hashUtilsModule.extractHashesFromSignedText(123 as any)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(hashUtilsModule.extractHashesFromSignedText("")).toBeNull();
      expect(hashUtilsModule.extractHashesFromSignedText("   ")).toBeNull();
    });

    it("should extract colon-separated hashes", () => {
      const reqHash = "a".repeat(64);
      const resHash = "b".repeat(64);
      const signedText = `${reqHash}:${resHash}`;

      const result = hashUtilsModule.extractHashesFromSignedText(signedText);

      expect(result).toEqual({ requestHash: reqHash, responseHash: resHash });
    });

    it("should handle whitespace around colon-separated hashes", () => {
      const reqHash = "a".repeat(64);
      const resHash = "b".repeat(64);
      const signedText = `  ${reqHash}  :  ${resHash}  `;

      const result = hashUtilsModule.extractHashesFromSignedText(signedText);

      expect(result).toEqual({ requestHash: reqHash, responseHash: resHash });
    });

    it("should extract hashes from text with surrounding content", () => {
      const reqHash = "c".repeat(64);
      const resHash = "d".repeat(64);
      const signedText = `prefix ${reqHash} middle ${resHash} suffix`;

      const result = hashUtilsModule.extractHashesFromSignedText(signedText);

      expect(result).toEqual({ requestHash: reqHash, responseHash: resHash });
    });

    it("should return null when fewer than 2 hashes found", () => {
      const singleHash = "e".repeat(64);
      const result = hashUtilsModule.extractHashesFromSignedText(singleHash);

      expect(result).toBeNull();
    });

    it("should use first two hashes when more than two present", () => {
      const hash1 = "1".repeat(64);
      const hash2 = "2".repeat(64);
      const hash3 = "3".repeat(64);
      const signedText = `${hash1} ${hash2} ${hash3}`;

      const result = hashUtilsModule.extractHashesFromSignedText(signedText);

      expect(result).toEqual({ requestHash: hash1, responseHash: hash2 });
    });

    it("should handle uppercase hex characters", () => {
      const reqHash = "A".repeat(64);
      const resHash = "B".repeat(64);
      const signedText = `${reqHash}:${resHash}`;

      const result = hashUtilsModule.extractHashesFromSignedText(signedText);

      expect(result).toEqual({ requestHash: reqHash, responseHash: resHash });
    });
  });

  describe("validateHashPair", () => {
    it("should return false for missing inputs", () => {
      expect(hashUtilsModule.validateHashPair(null, "hash", "text")).toBe(false);
      expect(hashUtilsModule.validateHashPair("hash", null, "text")).toBe(false);
      expect(hashUtilsModule.validateHashPair("hash", "hash", null)).toBe(false);
      expect(hashUtilsModule.validateHashPair(undefined, "hash", "text")).toBe(false);
    });

    it("should validate matching hash pair", () => {
      const reqHash = "a".repeat(64);
      const resHash = "b".repeat(64);
      const signedText = `${reqHash}:${resHash}`;

      expect(hashUtilsModule.validateHashPair(reqHash, resHash, signedText)).toBe(true);
    });

    it("should be case-insensitive", () => {
      const reqHash = "A".repeat(64);
      const resHash = "B".repeat(64);
      const signedText = `${"a".repeat(64)}:${"b".repeat(64)}`;

      expect(hashUtilsModule.validateHashPair(reqHash, resHash, signedText)).toBe(true);
    });

    it("should handle whitespace", () => {
      const reqHash = "a".repeat(64);
      const resHash = "b".repeat(64);
      const signedText = `  ${reqHash}:${resHash}  `;

      expect(hashUtilsModule.validateHashPair(reqHash, resHash, signedText)).toBe(true);
    });

    it("should return false for non-matching hashes", () => {
      const reqHash = "a".repeat(64);
      const resHash = "b".repeat(64);
      const wrongText = `${"c".repeat(64)}:${"d".repeat(64)}`;

      expect(hashUtilsModule.validateHashPair(reqHash, resHash, wrongText)).toBe(false);
    });
  });
});

// ============================================================================
// Tests for src/verification/hashes.ts (server-side)
// ============================================================================

describe("src/verification/hashes.ts", () => {
  let hashesModule: typeof import("@/verification/hashes");

  beforeEach(async () => {
    vi.resetModules();
    hashesModule = await import("@/verification/hashes");
  });

  describe("calculateRequestHash", () => {
    it("should calculate SHA256 hash of string", () => {
      const hash = hashesModule.calculateRequestHash("test payload");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should throw TypeError for non-string input", () => {
      expect(() => hashesModule.calculateRequestHash({ data: "test" } as any)).toThrow(TypeError);
      expect(() => hashesModule.calculateRequestHash(123 as any)).toThrow(TypeError);
    });

    it("should produce consistent hashes", () => {
      const payload = '{"messages":[]}';
      const hash1 = hashesModule.calculateRequestHash(payload);
      const hash2 = hashesModule.calculateRequestHash(payload);
      expect(hash1).toBe(hash2);
    });
  });

  describe("calculateResponseHash", () => {
    it("should calculate SHA256 hash of response text", () => {
      const hash = hashesModule.calculateResponseHash("response content");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("calculateStreamingHash", () => {
    it("should preserve trailing newlines", () => {
      const sseText = "data: test\n\ndata: more\n\n";
      const hash = hashesModule.calculateStreamingHash(sseText);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      const trimmedHash = hashesModule.calculateStreamingHash(sseText.trim());
      expect(hash).not.toBe(trimmedHash);
    });
  });

  describe("re-exports", () => {
    it("should re-export extractHashesFromSignedText", () => {
      expect(hashesModule.extractHashesFromSignedText).toBeDefined();
    });

    it("should re-export validateHashPair", () => {
      expect(hashesModule.validateHashPair).toBeDefined();
    });
  });
});
