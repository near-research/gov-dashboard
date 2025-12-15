import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ethers } from "ethers";
import { compareHashes, verifySignature } from "../signature";
import { sha256sum, extractChatId, parseSignatureText } from "../hash";
import { fetchAttestation } from "../attestation";
import { verifyChatMessage } from "../verify";
import { verifyNvidiaPayload, verifyNvidiaPayloads } from "../nvidia";

vi.mock("ethers", () => ({
  ethers: {
    verifyMessage: vi.fn(),
  },
}));

const createMockJwt = (claims: Record<string, unknown>): string => {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    ...claims,
    iat: Math.floor(Date.now() / 1000),
  };

  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  return `${encode(header)}.${encode(payload)}.signature`;
};

describe("verifyNvidiaPayload", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("returns overallResult true when NRAS returns valid attestation", async () => {
    const mockJwt = createMockJwt({
      "x-nvidia-overall-att-result": true,
      "x-nvidia-gpu-arch": "HOPPER",
      "x-nvidia-nonce": "test-nonce",
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [["JWT", mockJwt]],
    } as Response);

    const result = await verifyNvidiaPayload('{"payload":true}');

    expect(result.verified).toBe(true);
    expect(result.overallResult).toBe(true);
    expect(result.claims?.["x-nvidia-gpu-arch"]).toBe("HOPPER");
    expect(result.claims?.["x-nvidia-nonce"]).toBe("test-nonce");
    expect(result.error).toBeUndefined();
  });

  it("returns overallResult false when claim is false", async () => {
    const mockJwt = createMockJwt({
      "x-nvidia-overall-att-result": false,
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [["JWT", mockJwt]],
    } as Response);

    const result = await verifyNvidiaPayload('{"payload":true}');

    expect(result.verified).toBe(false);
    expect(result.overallResult).toBe(false);
    expect(result.error).toContain("overall attestation result is false");
  });

  it("returns verified false on network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const result = await verifyNvidiaPayload('{"payload":true}');

    expect(result.verified).toBe(false);
    expect(result.overallResult).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("returns verified false on non-200 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    const result = await verifyNvidiaPayload('{"payload":true}');

    expect(result.verified).toBe(false);
    expect(result.overallResult).toBe(false);
    expect(result.error).toContain("request failed");
  });

  it("returns verified false on invalid JWT", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [["JWT", "not-a-jwt"]],
    } as Response);

    const result = await verifyNvidiaPayload('{"payload":true}');

    expect(result.verified).toBe(false);
    expect(result.overallResult).toBe(false);
    expect(result.claims).toEqual({});
  });

  it("treats missing overall claim as false", async () => {
    const mockJwt = createMockJwt({
      "x-nvidia-gpu-arch": "HOPPER",
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [["JWT", mockJwt]],
    } as Response);

    const result = await verifyNvidiaPayload('{"payload":true}');

    expect(result.verified).toBe(false);
    expect(result.overallResult).toBe(false);
    expect(result.error).toContain("overall attestation result is false");
  });

  it("respects timeout and aborts the request", async () => {
    vi.mocked(fetch).mockImplementationOnce((_, options) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener?.("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const result = await verifyNvidiaPayload('{"payload":true}', { timeout: 50 });

    expect(result.verified).toBe(false);
    expect(result.error).toContain("timed out");
  });
});

describe("verifyNvidiaPayloads", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("processes multiple payloads", async () => {
    const mockJwt = createMockJwt({ "x-nvidia-overall-att-result": true });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [["JWT", mockJwt]],
    } as Response);

    const { allPassed, results } = await verifyNvidiaPayloads([
      '{"payload":"1"}',
      '{"payload":"2"}',
      '{"payload":"3"}',
    ]);

    expect(results).toHaveLength(3);
    expect(allPassed).toBe(true);
    expect(results.every((r) => r.overallResult)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("returns partial results when some payloads fail", async () => {
    const successJwt = createMockJwt({ "x-nvidia-overall-att-result": true });
    const failJwt = createMockJwt({ "x-nvidia-overall-att-result": false });

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [["JWT", successJwt]],
      } as Response)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [["JWT", failJwt]],
      } as Response);

    const { results } = await verifyNvidiaPayloads([
      '{"payload":"1"}',
      '{"payload":"2"}',
      '{"payload":"3"}',
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].overallResult).toBe(true);
    expect(results[1].verified).toBe(false);
    expect(results[2].overallResult).toBe(false);
  });

  it("handles empty payload arrays", async () => {
    const { allPassed, results } = await verifyNvidiaPayloads([]);

    expect(results).toEqual([]);
    expect(allPassed).toBe(true);
  });
});

describe("hash utilities", () => {
  it("computes SHA-256 correctly", () => {
    expect(sha256sum("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
    expect(sha256sum("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(sha256sum("こんにちは")).toHaveLength(64);
  });

  it("extracts chat ID from SSE payload", () => {
    const response =
      'data: {"id":"chatcmpl-foo","object":"chat.completion.chunk"}\n\n';
    expect(extractChatId(response)).toBe("chatcmpl-foo");
  });

  it("returns null when chat ID cannot be parsed", () => {
    expect(extractChatId("no data")).toBeNull();
    expect(extractChatId("data: {invalid}")).toBeNull();
  });

  it("parses signature text", () => {
    expect(parseSignatureText("abc:def")).toEqual({
      requestHash: "abc",
      responseHash: "def",
    });
    expect(parseSignatureText("abc")).toBeNull();
    expect(parseSignatureText("abc:def:ghi")).toBeNull();
    expect(parseSignatureText(":def")).toBeNull();
  });
});

describe("signature helpers", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("compares hashes correctly", () => {
    const match = compareHashes("abc:def", "abc", "def");
    expect(match.valid).toBe(true);
    expect(match.requestHashMatch).toBe(true);
    expect(match.responseHashMatch).toBe(true);

    const requestMismatch = compareHashes("abc:def", "wrong", "def");
    expect(requestMismatch.valid).toBe(false);
    expect(requestMismatch.requestHashMatch).toBe(false);
    expect(requestMismatch.responseHashMatch).toBe(true);

    const responseMismatch = compareHashes("abc:def", "abc", "wrong");
    expect(responseMismatch.valid).toBe(false);
    expect(responseMismatch.requestHashMatch).toBe(true);
    expect(responseMismatch.responseHashMatch).toBe(false);
  });

  it("validates signature accurately", () => {
    vi.mocked(ethers.verifyMessage).mockReturnValue("0xabc");
    const result = verifySignature("text", "sig", ["0xAbC"]);
    expect(result.valid).toBe(true);
    expect(result.teeAttested).toBe(true);
    expect(result.expectedAddresses).toEqual(["0xAbC"]);
  });

  it("performs case-insensitive address matching", () => {
    vi.mocked(ethers.verifyMessage).mockReturnValue("0xabc");
    const result = verifySignature("text", "sig", ["0xABC"]);
    expect(result.valid).toBe(true);
    expect(result.teeAttested).toBe(true);
  });

  it("rejects unknown addresses", () => {
    vi.mocked(ethers.verifyMessage).mockReturnValue("0xdef");
    const result = verifySignature("text", "sig", ["0xabc"]);
    expect(result.valid).toBe(false);
    expect(result.teeAttested).toBe(false);
  });

  it("handles signature verification errors", () => {
    vi.mocked(ethers.verifyMessage).mockImplementation(() => {
      throw new Error("bad sig");
    });
    const result = verifySignature("text", "sig", []);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("bad sig");
  });
});

describe("verifyChatMessage flow", () => {
  const requestBody = '{"model":"test","messages":[],"stream":true}';
  const responseText = 'data: {"id":"chatcmpl-123"}\n\n';
  const requestHash = sha256sum(requestBody);
  const responseHash = sha256sum(responseText);

  beforeEach(() => {
    process.env.NEAR_AI_CLOUD_API_KEY = "test-api-key";
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(ethers.verifyMessage).mockReset();
  });

  afterEach(() => {
    delete process.env.NEAR_AI_CLOUD_API_KEY;
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("fails when chat ID cannot be parsed", async () => {
    const result = await verifyChatMessage(
      requestBody,
      "no data",
      "test-model"
    );

    expect(result.verified).toBe(false);
    expect(result.error).toContain("chat ID");
  });

  it("fails when attestation fetch rejects", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network"));

    const result = await verifyChatMessage(
      requestBody,
      responseText,
      "test-model"
    );

    expect(result.verified).toBe(false);
    expect(result.error).toContain("Attestation");
  });

  it("fails when hash comparison fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_attestations: [{ signing_address: "0xtee" }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: "wrong:hash",
          signature: "0xsig",
          signing_address: "0xtee",
          signing_algo: "ecdsa",
        }),
      } as Response);

    vi.mocked(ethers.verifyMessage).mockReturnValue("0xtee");

    const result = await verifyChatMessage(
      requestBody,
      responseText,
      "test-model"
    );

    expect(result.verified).toBe(false);
    expect(result.error?.toLowerCase()).toContain("hash");
  });

  describe("with verifyNvidia option", () => {
    it("runs NVIDIA verification when requested", async () => {
      const attestation = {
        model_attestations: [
          {
            signing_address: "0xtee",
            nvidia_payload: '{"payload":true}',
          },
        ],
      };

      const signaturePayload = {
        text: `${requestHash}:${responseHash}`,
        signature: "0xsig",
        signing_address: "0xtee",
        signing_algo: "ecdsa",
      };

      const mockJwt = createMockJwt({
        "x-nvidia-overall-att-result": true,
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => attestation } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [["JWT", mockJwt]],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => signaturePayload,
        } as Response);

      vi.mocked(ethers.verifyMessage).mockReturnValue("0xtee");

      const result = await verifyChatMessage(requestBody, responseText, "test-model", {
        verifyNvidia: true,
      });

      expect(result.verified).toBe(true);
      expect(result.attestation?.nvidiaVerification?.performed).toBe(true);
      expect(result.attestation?.nvidiaVerification?.allPassed).toBe(true);
      expect(result.signatureValidation?.teeAttested).toBe(true);
    });

    it("skips NVIDIA verification when verifyNvidia is false", async () => {
      const attestation = {
        model_attestations: [
          {
            signing_address: "0xtee",
            nvidia_payload: '{"payload":true}',
          },
        ],
      };

      const signaturePayload = {
        text: `${requestHash}:${responseHash}`,
        signature: "0xsig",
        signing_address: "0xtee",
        signing_algo: "ecdsa",
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => attestation } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => signaturePayload,
        } as Response);

      vi.mocked(ethers.verifyMessage).mockReturnValue("0xtee");

      const result = await verifyChatMessage(
        requestBody,
        responseText,
        "test-model",
        { verifyNvidia: false }
      );

      expect(result.verified).toBe(true);
      expect(result.attestation?.nvidiaVerification).toBeUndefined();
    });

    it("fails when NVIDIA verification fails and flag is true", async () => {
      const attestation = {
        model_attestations: [
          {
            signing_address: "0xtee",
            nvidia_payload: '{"payload":true}',
          },
        ],
      };

      const mockJwt = createMockJwt({
        "x-nvidia-overall-att-result": false,
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => attestation } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jwt: mockJwt }),
        } as Response);

      const result = await verifyChatMessage(
        requestBody,
        responseText,
        "test-model",
        { verifyNvidia: true }
      );

      expect(result.verified).toBe(false);
      expect(result.error).toContain("Attestation");
    });

    it("succeeds when NVIDIA verification is disabled even if payload would fail", async () => {
      const attestation = {
        model_attestations: [
          {
            signing_address: "0xtee",
            nvidia_payload: '{"payload":true}',
          },
        ],
      };

      const signaturePayload = {
        text: `${requestHash}:${responseHash}`,
        signature: "0xsig",
        signing_address: "0xtee",
        signing_algo: "ecdsa",
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => attestation } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => signaturePayload,
        } as Response);

      vi.mocked(ethers.verifyMessage).mockReturnValue("0xtee");

      const result = await verifyChatMessage(
        requestBody,
        responseText,
        "test-model"
      );

      expect(result.verified).toBe(true);
      expect(result.attestation?.nvidiaVerification).toBeUndefined();
    });
  });
});

describe("fetchAttestation edge cases", () => {
  beforeEach(() => {
    process.env.NEAR_AI_CLOUD_API_KEY = "test-api-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    delete process.env.NEAR_AI_CLOUD_API_KEY;
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("handles empty model_attestations", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model_attestations: [] }),
    } as Response);

    const result = await fetchAttestation("test-model");

    expect(result.teeAddresses).toEqual([]);
    expect(result.hasNvidiaPayload).toBe(false);
  });

  it("handles missing model_attestations field", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await fetchAttestation("test-model");

    expect(result.teeAddresses).toEqual([]);
  });

  it("handles attestations without nvidia payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model_attestations: [
          { signing_address: "0x1" },
          { signing_address: "0x2" },
        ],
      }),
    } as Response);

    const result = await fetchAttestation("test-model");

    expect(result.teeAddresses).toEqual(["0x1", "0x2"]);
    expect(result.hasNvidiaPayload).toBe(false);
  });

  it("deduplicates signing addresses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model_attestations: [
          { signing_address: "0x1" },
          { signing_address: "0x1" },
          { signing_address: "0x2" },
        ],
      }),
    } as Response);

    const result = await fetchAttestation("test-model");

    expect(result.teeAddresses).toEqual(["0x1", "0x2"]);
  });

  it("includes signing_algo=ecdsa in the request URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model_attestations: [] }),
    } as Response);

    await fetchAttestation("test-model");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("signing_algo=ecdsa"),
      expect.any(Object)
    );
  });

  it("throws on non-200 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Error",
    } as Response);

    await expect(fetchAttestation("test-model")).rejects.toThrow();
  });

  it("respects timeout option", async () => {
    vi.mocked(fetch).mockImplementationOnce((_, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener?.("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    await expect(
      fetchAttestation("test-model", { timeout: 50 })
    ).rejects.toThrow();
  });
});
