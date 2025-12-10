import { describe, it, expect, beforeEach, vi } from "vitest";
import { NearAIClient } from "@/lib/near-ai/client";

describe("NearAIClient.verify()", () => {
  let client: NearAIClient;
  const fetchMock = vi.fn();

  beforeEach(() => {
    client = new NearAIClient({ apiKey: "test-key" });
    client.clearAllSessions();
    vi.clearAllMocks();
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
