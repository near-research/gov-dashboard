import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NearAIClient } from "@/lib/near-ai/client";

describe("NearAIClient Verification", () => {
  let client: NearAIClient;

  beforeEach(() => {
    client = new NearAIClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    client.clearAllSessions();
    vi.restoreAllMocks();
  });

  describe("Session Management", () => {
    it("creates session with 64-char hex nonce (32 bytes)", () => {
      const session = client.createSession("test-id");

      expect(session.nonce).toHaveLength(64);
      expect(session.nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(session.expiresAt).toBeGreaterThan(Date.now());
    });

    it("returns existing session if not expired", () => {
      const session1 = client.createSession("test-id");
      const session2 = client.createSession("test-id");

      expect(session1.nonce).toBe(session2.nonce);
    });

    it("returns null for non-existent session", () => {
      expect(client.getSession("nonexistent")).toBeNull();
    });

    it("updates session hashes", () => {
      client.createSession("test-id");
      client.updateSessionHashes("test-id", {
        requestHash: "abc123",
        responseHash: "def456",
      });

      const session = client.getSession("test-id");
      expect(session?.requestHash).toBe("abc123");
      expect(session?.responseHash).toBe("def456");
    });

    it("clears specific session", () => {
      client.createSession("test-id");
      client.clearSession("test-id");

      expect(client.getSession("test-id")).toBeNull();
    });

    it("clears all sessions", () => {
      client.createSession("test-1");
      client.createSession("test-2");
      client.clearAllSessions();

      expect(client.getSession("test-1")).toBeNull();
      expect(client.getSession("test-2")).toBeNull();
    });

    it("generates unique nonces", () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const session = client.createSession(`test-${i}`);
        nonces.add(session.nonce);
      }
      expect(nonces.size).toBe(100);
    });
  });

  describe("extractNvidiaPayload", () => {
    it("extracts from model_attestations array", () => {
      const attestation = {
        model_attestations: [
          { signing_address: "0x123", nvidia_payload: { nonce: "abc" } }
        ]
      };

      const payload = (client as any).extractNvidiaPayload(attestation);
      expect(payload).toEqual({ nonce: "abc" });
    });

    it("extracts from gateway_attestation", () => {
      const attestation = {
        gateway_attestation: { nvidia_payload: { nonce: "def" } }
      };

      const payload = (client as any).extractNvidiaPayload(attestation);
      expect(payload).toEqual({ nonce: "def" });
    });

    it("extracts from root level", () => {
      const attestation = {
        nvidia_payload: { nonce: "ghi" }
      };

      const payload = (client as any).extractNvidiaPayload(attestation);
      expect(payload).toEqual({ nonce: "ghi" });
    });

    it("returns null for missing payload", () => {
      const payload = (client as any).extractNvidiaPayload({});
      expect(payload).toBeNull();
    });

    it("sanitizes payload to only NRAS fields", () => {
      const attestation = {
        nvidia_payload: {
          nonce: "abc",
          request_nonce: "should-not-show",
          extra: "drop",
          evidence_list: [{ certificate: "foo", evidence: "bar" }],
        },
      };

      const payload = (client as any).extractNvidiaPayload(attestation);
      expect(payload).toEqual({
        nonce: "abc",
        evidence_list: [{ certificate: "foo", evidence: "bar" }],
      });
    });
  });

  describe("collectSigningAddresses", () => {
    it("collects addresses from model_attestations and gateway", () => {
      const attestation = {
        model_attestations: [
          { signing_address: "0xAAA" },
          { signing_address: "0xBBB" }
        ],
        gateway_attestation: { signing_address: "0xCCC" }
      };

      const addresses = (client as any).collectSigningAddresses(attestation);
      expect(addresses).toContain("0xAAA");
      expect(addresses).toContain("0xBBB");
      expect(addresses).toContain("0xCCC");
    });

    it("deduplicates addresses", () => {
      const attestation = {
        model_attestations: [{ signing_address: "0xAAA" }],
        gateway_attestation: { signing_address: "0xAAA" }
      };

      const addresses = (client as any).collectSigningAddresses(attestation);
      expect(addresses).toHaveLength(1);
    });

    it("ignores non-0x addresses", () => {
      const attestation = {
        model_attestations: [{ signing_address: "not-an-address" }],
        gateway_attestation: { signing_address: "0xVALID" }
      };

      const addresses = (client as any).collectSigningAddresses(attestation);
      expect(addresses).toEqual(["0xVALID"]);
    });
  });

  describe("checkNonceBinding", () => {
    it("validates matching nonce from gateway_attestation", () => {
      const nonce = "a".repeat(64);
      const attestation = {
        gateway_attestation: { request_nonce: nonce }
      };

      const result = (client as any).checkNonceBinding(nonce, attestation);
      expect(result.valid).toBe(true);
      expect(result.expected).toBe(nonce);
      expect(result.attested).toBe(nonce);
    });

    it("validates case-insensitive nonce", () => {
      const nonce = "A".repeat(64);
      const attestation = {
        gateway_attestation: { request_nonce: "a".repeat(64) }
      };

      const result = (client as any).checkNonceBinding(nonce, attestation);
      expect(result.valid).toBe(true);
    });

    it("fails for mismatched nonce", () => {
      const attestation = {
        gateway_attestation: { request_nonce: "b".repeat(64) }
      };

      const result = (client as any).checkNonceBinding("a".repeat(64), attestation);
      expect(result.valid).toBe(false);
    });

    it("fails for missing attestation", () => {
      const result = (client as any).checkNonceBinding("a".repeat(64), null);
      expect(result.valid).toBe(false);
      expect(result.attested).toBeNull();
    });
  });

  describe("extractNrasJwt", () => {
    it("extracts JWT from NRAS array response", () => {
      const data = [
        ["JWT", "eyJhbGciOiJFUzM4NCJ9.test"],
        { "GPU-0": "eyJ..." }
      ];

      const jwt = (client as any).extractNrasJwt(data);
      expect(jwt).toBe("eyJhbGciOiJFUzM4NCJ9.test");
    });

    it("extracts JWT from object response", () => {
      const data = { jwt: "eyJhbGciOiJFUzM4NCJ9.test" };

      const jwt = (client as any).extractNrasJwt(data);
      expect(jwt).toBe("eyJhbGciOiJFUzM4NCJ9.test");
    });

    it("returns null for missing JWT", () => {
      const jwt = (client as any).extractNrasJwt([]);
      expect(jwt).toBeNull();
    });
  });

  describe("validateNrasClaims", () => {
    it("passes valid claims", () => {
      const nonce = "a".repeat(64);
      const claims = {
        "x-nvidia-overall-att-result": true,
        eat_nonce: nonce,
        secboot: true,
        measres: "success",
      };

      const reasons = (client as any).validateNrasClaims(claims, nonce);
      expect(reasons).toHaveLength(0);
    });

    it("fails for false overall result", () => {
      const nonce = "a".repeat(64);
      const claims = {
        "x-nvidia-overall-att-result": false,
        eat_nonce: nonce,
        secboot: true,
      };

      const reasons = (client as any).validateNrasClaims(claims, nonce);
      expect(reasons).toContain("x-nvidia-overall-att-result is not true");
    });

    it("fails for nonce mismatch", () => {
      const claims = {
        "x-nvidia-overall-att-result": true,
        eat_nonce: "b".repeat(64),
        secboot: true,
      };

      const reasons = (client as any).validateNrasClaims(claims, "a".repeat(64));
      expect(reasons.some((r: string) => r.includes("Nonce mismatch"))).toBe(true);
    });

    it("fails for disabled secboot", () => {
      const nonce = "a".repeat(64);
      const claims = {
        "x-nvidia-overall-att-result": true,
        eat_nonce: nonce,
        secboot: false,
      };

      const reasons = (client as any).validateNrasClaims(claims, nonce);
      expect(reasons).toContain("Secure boot (secboot) is not enabled");
    });
  });

  describe("NearAIClient error paths (coverage)", () => {
    it("returns null when signature fetch repeatedly fails", async () => {
      const fetchWithTimeoutSpy = vi
        .spyOn(client as any, "fetchWithTimeout")
        .mockRejectedValue(new Error("network failure"));

      const result = await client.fetchCanonicalHashes({
        remoteMessageId: "chat-123",
        model: "test-model",
      });

      expect(result).toBeNull();
      expect(fetchWithTimeoutSpy).toHaveBeenCalled();
    });

    it("reports NRAS HTTP failures", async () => {
      const response = {
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue("service unavailable"),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const attestation = { nvidia_payload: { foo: "bar" } };
      const result = await client.verifyWithNras(attestation, "a".repeat(64));

      expect(result.verified).toBe(false);
      expect(result.reasons?.[0]).toContain("NRAS HTTP 503");
    });

    it("reports missing JWT in NRAS response", async () => {
      const response = {
        ok: true,
        json: vi.fn().mockResolvedValue({ foo: "bar" }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const attestation = { nvidia_payload: { foo: "bar" } };
      const result = await client.verifyWithNras(attestation, "a".repeat(64));

      expect(result.verified).toBe(false);
      expect(result.reasons).toContain("No JWT in NRAS response");
      expect(result.raw).toEqual({ foo: "bar" });
    });

    it("reports failed JWT verification", async () => {
      const response = {
        ok: true,
        json: vi.fn().mockResolvedValue({ jwt: "fake.jwt" }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      vi.spyOn(client as any, "verifyNrasJwt").mockResolvedValue(null);

      const attestation = { nvidia_payload: { foo: "bar" } };
      const result = await client.verifyWithNras(attestation, "a".repeat(64));

      expect(result.verified).toBe(false);
      expect(result.reasons).toContain("JWT signature verification failed");
      expect(result.jwt).toBe("fake.jwt");
    });

    it("captures measres failures in claims validation", () => {
      const nonce = "a".repeat(64);
      const claims = {
        "x-nvidia-overall-att-result": true,
        eat_nonce: nonce,
        secboot: true,
        measres: "failed",
      };

      const reasons = (client as any).validateNrasClaims(claims, nonce);
      expect(reasons).toContain("Measurement results (measres): failed");
    });
  });

  describe("fetchCanonicalHashes hash extraction errors", () => {
    it("logs warning and continues when signature text cannot be parsed", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const invalidResponse = {
        ok: true,
        json: async () => ({ text: "invalid-text", signature: "0x123" }),
      } as unknown as Response;
      const validResponse = {
        ok: true,
        json: async () => ({
          text: `${"c".repeat(64)}:${"d".repeat(64)}`,
          signature: "0x456",
        }),
      } as unknown as Response;

      vi.spyOn(client as any, "fetchWithTimeout")
        .mockResolvedValueOnce(invalidResponse)
        .mockResolvedValueOnce(validResponse);

      const result = await client.fetchCanonicalHashes({
        remoteMessageId: "chat-123",
        fallbackId: "chat-456",
        model: "test-model",
      });

      expect(warnSpy).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it("logs error and returns null when JSON parsing fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const failingResponse = {
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as unknown as Response;

      vi.spyOn(client as any, "fetchWithTimeout").mockResolvedValue(failingResponse);

      const result = await client.fetchCanonicalHashes({
        remoteMessageId: "chat-123",
        model: "test-model",
      });

      expect(errorSpy).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe("verifyWithNras failure paths", () => {
    it("returns verified:false when JWT is missing from NRAS response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ([]),
      } as Response);

      const result = await client.verifyWithNras(
        { nvidia_payload: { foo: "bar" } },
        "a".repeat(64)
      );

      expect(result.verified).toBe(false);
      expect(result.reasons?.length).toBeGreaterThan(0);
    });

    it("returns verified:false when verifyNrasJwt returns null", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: "bad.jwt" }),
      } as Response);
      vi.spyOn(client as any, "verifyNrasJwt").mockResolvedValue(null);

      const result = await client.verifyWithNras({ nvidia_payload: {} }, "b".repeat(64));

      expect(result.verified).toBe(false);
      expect(result.reasons).toContain("JWT signature verification failed");
    });

    it("aggregates claim validation reasons when multiple checks fail", async () => {
      const badClaims = {
        eat_nonce: "wrong-nonce",
        "x-nvidia-overall-att-result": false,
        secboot: false,
        measres: "FAILURE",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: "claims.jwt" }),
      } as Response);
      vi.spyOn(client as any, "verifyNrasJwt").mockResolvedValue(badClaims);

      const result = await client.verifyWithNras({ nvidia_payload: {} }, "c".repeat(64));

      expect(result.verified).toBe(false);
      expect(result.reasons?.length).toBeGreaterThanOrEqual(2);
    });

    it("catches fetch errors and returns verified:false with error reason", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network timeout"));

      const result = await client.verifyWithNras({ nvidia_payload: {} }, "d".repeat(64));

      expect(result.verified).toBe(false);
      expect(result.reasons?.some((reason) => /timeout|network/i.test(reason))).toBe(true);
    });
  });
});
