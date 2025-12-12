import { describe, it, expect, vi } from "vitest";

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

    it("should return 'pending' for blank or pending-like values", () => {
      expect(normalizeModule.toVerificationStatus("pending")).toBe("pending");
      expect(normalizeModule.toVerificationStatus("processing")).toBe("pending");
      expect(normalizeModule.toVerificationStatus("")).toBe("pending");
      expect(normalizeModule.toVerificationStatus(undefined)).toBe("pending");
    });

    it("should return 'unknown' for unrecognized values", () => {
      expect(normalizeModule.toVerificationStatus("unknown")).toBe("unknown");
      expect(normalizeModule.toVerificationStatus("extra")).toBe("unknown");
      expect(normalizeModule.toVerificationStatus("123")).toBe("unknown");
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

    it("should hydrate pending verification data when fallback ID provided", () => {
      const result = normalizeModule.normalizeVerificationPayload(null, "fallback-id");

      expect(result.verification).toEqual({
        source: "near-ai-cloud",
        status: "pending",
        messageId: "fallback-id",
      });
      expect(result.verificationId).toBe("fallback-id");
    });

    it("should propagate existing metadata messageId", () => {
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
