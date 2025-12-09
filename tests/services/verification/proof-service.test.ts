import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchVerificationProof,
  verifyWithNrasService,
} from "@/services/verification/proof-service";

const mockFetch = vi.fn();

describe("src/services/verification/proof-service.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchVerificationProof", () => {
    const defaultParams = {
      verificationId: "ver-123",
      model: "claude-3",
      requestHash: "req-hash",
      responseHash: "res-hash",
      expectationInput: {
        nonce: "test-nonce",
        arch: "x86_64",
        deviceCertHash: "cert-hash",
        rimHash: "rim-hash",
        ueid: "ueid-value",
        measurements: ["measurement-1"],
      },
      signingAlgo: "ecdsa",
    };

    it("should make POST request with correct parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await fetchVerificationProof(defaultParams);

      expect(mockFetch).toHaveBeenCalledWith("/api/verification/proof", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationId: "ver-123",
          model: "claude-3",
          requestHash: "req-hash",
          responseHash: "res-hash",
          nonce: "test-nonce",
          expectedArch: "x86_64",
          expectedDeviceCertHash: "cert-hash",
          expectedRimHash: "rim-hash",
          expectedUeid: "ueid-value",
            expectedMeasurements: ["measurement-1"],
          signingAlgo: "ecdsa",
        }),
      });
    });

    it("should return mapped RemoteProof with all fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          attestation: "att-data",
          signature: "sig-data",
          signatureError: null,
          nras: { verified: true },
          nrasRaw: { raw: "data" },
          nonceCheck: { valid: true },
          intel: { report: "intel-report" },
          results: { passed: true },
          configMissing: false,
        }),
      });

      const result = await fetchVerificationProof(defaultParams);

      expect(result).toEqual({
        attestation: "att-data",
        signature: "sig-data",
        signatureError: null,
        nras: { verified: true },
        nrasRaw: { raw: "data" },
        nonceCheck: { valid: true },
        intel: { report: "intel-report" },
        results: { passed: true },
        configMissing: false,
      });
    });

    it("should default missing fields to null/undefined", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await fetchVerificationProof(defaultParams);

      expect(result).toEqual({
        attestation: null,
        signature: null,
        signatureError: null,
        nras: null,
        nrasRaw: null,
        nonceCheck: null,
        intel: null,
        results: undefined,
        configMissing: undefined,
      });
    });

    it("should handle optional parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await fetchVerificationProof({
        expectationInput: {},
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/verification/proof",
        expect.objectContaining({
          body: JSON.stringify({
            verificationId: undefined,
            model: undefined,
            requestHash: undefined,
            responseHash: undefined,
            nonce: undefined,
            expectedArch: undefined,
            expectedDeviceCertHash: undefined,
            expectedRimHash: undefined,
            expectedUeid: undefined,
            expectedMeasurements: undefined,
            signingAlgo: undefined,
          }),
        })
      );
    });

    describe("error handling", () => {
      it("should throw with parsed error message", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ error: "Server error occurred" }),
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          "Server error occurred"
        );
      });

      it("should prefer details over error field", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () =>
            JSON.stringify({
              details: "Detailed error",
              error: "Generic error",
            }),
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          "Detailed error"
        );
      });

      it("should prefer error over message field", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () =>
            JSON.stringify({
              error: "Error field",
              message: "Message field",
            }),
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          "Error field"
        );
      });

      it("should append expiration hint for 404 errors", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ error: "Not found" }),
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          /Not found[\s\S]*Proof may have expired/
        );
      });

      it("should append auth hint for 401 errors", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: "Unauthorized" }),
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          /Unauthorized[\s\S]*Authentication error/
        );
      });

      it("should append auth hint for 403 errors", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => JSON.stringify({ error: "Forbidden" }),
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          /Forbidden[\s\S]*Authentication error/
        );
      });

      it("should fall back to raw text when JSON parsing fails", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Plain text error message",
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          "Plain text error message"
        );
      });

      it("should use default message for empty response", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "",
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          "Failed to fetch proof"
        );
      });

      it("should use default message when no error fields present", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ unrelated: "data" }),
        });

        await expect(fetchVerificationProof(defaultParams)).rejects.toThrow(
          "Failed to fetch proof"
        );
      });
    });
  });

  describe("verifyWithNrasService", () => {
    const defaultParams = {
      verificationId: "ver-123",
      payload: { attestation: "data", nonce: "test-nonce" },
    };

    it("should make POST request with correct parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verified: true }),
      });

      await verifyWithNrasService(defaultParams);

      expect(mockFetch).toHaveBeenCalledWith("/api/verification/nras", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationId: "ver-123",
          payload: { attestation: "data", nonce: "test-nonce" },
        }),
      });
    });

    it("should return parsed response data on success", async () => {
      const responseData = {
        verified: true,
        claims: { iss: "nvidia" },
        raw: { token: "jwt-token" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseData,
      });

      const result = await verifyWithNrasService(defaultParams);

      expect(result).toEqual(responseData);
    });

    it("should handle optional verificationId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await verifyWithNrasService({
        payload: { data: "test" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/verification/nras",
        expect.objectContaining({
          body: JSON.stringify({
            verificationId: undefined,
            payload: { data: "test" },
          }),
        })
      );
    });

    describe("error handling", () => {
      it("should throw with error message from response", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: "NRAS verification failed" }),
        });

        await expect(verifyWithNrasService(defaultParams)).rejects.toThrow(
          "NRAS verification failed"
        );
      });

      it("should use default message when error field missing", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({}),
        });

        await expect(verifyWithNrasService(defaultParams)).rejects.toThrow(
          "Failed to verify with NVIDIA NRAS service"
        );
      });

      it("should use default message when json parsing fails", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => {
            throw new Error("JSON parse error");
          },
        });

        await expect(verifyWithNrasService(defaultParams)).rejects.toThrow();
      });
    });
  });
});
