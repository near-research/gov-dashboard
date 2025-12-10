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
});
