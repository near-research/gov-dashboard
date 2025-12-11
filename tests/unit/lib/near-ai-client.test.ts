import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  SignaturePayload,
  SignatureVerificationResult,
} from "@/types/verification";
import { NearAIClient } from "@/lib/near-ai/client";
import { verifyMessage } from "ethers";

vi.mock("ethers", () => ({
  verifyMessage: vi.fn(),
}));
const verifyMessageMock = vi.mocked(verifyMessage);

describe("NearAIClient.verify()", () => {
  let client: NearAIClient;
  const fetchMock = vi.fn();

  beforeEach(() => {
    client = new NearAIClient({ apiKey: "test-key" });
    client.clearAllSessions();
    vi.clearAllMocks();
    verifyMessageMock.mockReturnValue("0xattested");
    fetchMock.mockReset();
    global.fetch = fetchMock as typeof globalThis.fetch;
  });

  it("returns error when session not found", async () => {
    const result = await client.verify({
      verificationId: "non-existent",
      model: "test-model",
    });

    expect(result.verified).toBe(false);
    expect(result.reasons).toContainEqual(expect.stringMatching(/session/i));
  });

  it("fetches attestation and signature in parallel", async () => {
    client.createSession("test-id");

    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/attestation")) {
        return {
          ok: true,
          json: async () => ({ model_attestations: [] }),
        } as Response;
      }
      if (String(url).includes("/signature")) {
        return {
          ok: true,
          json: async () => ({ text: "a:b", signature: "0x" }),
        } as Response;
      }
      return { ok: false } as Response;
    });

    await client.verify({
      verificationId: "test-id",
      model: "test-model",
      chatId: "chat-123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns verified:false when NRAS fails", async () => {
    client.createSession("test-id");

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        model_attestations: [{ nvidia_payload: {} }],
        gateway_attestation: { request_nonce: "wrong-nonce" },
      }),
    } as Response);

    const result = await client.verify({
      verificationId: "test-id",
      model: "test-model",
    });

    expect(result.verified).toBe(false);
  });
});

describe("NearAIClient.verifySignature()", () => {
  let client: NearAIClient;

  const invokeVerifySignature = (
    signature: SignaturePayload | null,
    requestHash?: string | null,
    responseHash?: string | null,
    attestedAddresses: string[] = []
  ) =>
    (client as any).verifySignature(
      signature,
      requestHash,
      responseHash,
      attestedAddresses
    ) as SignatureVerificationResult;

  beforeEach(() => {
    client = new NearAIClient({ apiKey: "test-key" });
    verifyMessageMock.mockReset();
    verifyMessageMock.mockReturnValue("0xattested");
  });

  it("returns false when signature is null", () => {
    const result = invokeVerifySignature(null, "reqHash", "resHash", ["0xaddr"]);

    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/signature/i);
  });

  it("returns false when signature.text is missing", () => {
    const payload = { signature: "0x123" } as SignaturePayload;
    const result = invokeVerifySignature(payload, "reqHash", "resHash", [
      "0xaddr",
    ]);

    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/signature or signed text/i);
  });

  it("returns false when signed hashes do not match expected", () => {
    const payload = { text: "wrongReq:wrongRes", signature: "0x123" };
    const result = invokeVerifySignature(payload, "reqHash", "resHash", [
      "0xaddr",
    ]);

    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/hash mismatch/i);
  });

  it("returns false when verifyMessage throws", () => {
    verifyMessageMock.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const payload = { text: "reqHash:resHash", signature: "0xinvalid" };
    const result = invokeVerifySignature(payload, "reqHash", "resHash", [
      "0xaddr",
    ]);

    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/failed to recover address/i);
  });

  it("returns false when recovered address not in attested list", () => {
    verifyMessageMock.mockReturnValue("0xrecovered");

    const payload = { text: "reqHash:resHash", signature: "0x123" };
    const result = invokeVerifySignature(payload, "reqHash", "resHash", [
      "0xdifferent",
    ]);

    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/attested addresses/i);
    expect(result.recoveredAddress).toBe("0xrecovered");
  });

  it("returns true when signature is valid and address matches", () => {
    verifyMessageMock.mockReturnValue("0xAttested");

    const payload = { text: "reqHash:resHash", signature: "0x123" };
    const result = invokeVerifySignature(payload, "reqHash", "resHash", [
      "0xattested",
    ]);

    expect(result.verified).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.recoveredAddress).toBe("0xAttested");
  });
});
