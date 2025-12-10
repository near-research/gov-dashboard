import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchHardwareExpectations,
  clearHardwareExpectationsCache,
} from "@/utils/attestation/hardware";

const mockPayload = {
  nonce: "n1",
  arch: "HOPPER",
  evidence_list: [
    {
      device_cert_hash: "dhash",
      rim: "rhash",
      ueid: "ueid123",
      measurements: ["m1", { hash: "m2" }],
    },
  ],
};

describe("hardware-expectations", () => {
  const originalEnv = process.env.NEAR_AI_CLOUD_API_KEY;

  beforeEach(() => {
    process.env.NEAR_AI_CLOUD_API_KEY = "test-key";
    clearHardwareExpectationsCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NEAR_AI_CLOUD_API_KEY = originalEnv;
  });

  it("fetches and parses expectations from nvidia_payload string", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nvidia_payload: JSON.stringify(mockPayload),
      }),
    });
    // @ts-ignore
    global.fetch = fetchMock;

    const expectations = await fetchHardwareExpectations("modelA");
    expect(expectations).toEqual({
      nonce: "n1",
      arch: "HOPPER",
      deviceCertHash: "dhash",
      rimHash: "rhash",
      ueid: "ueid123",
      measurements: ["m1", "m2"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors cache for 5 minutes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nvidia_payload: mockPayload,
      }),
    });
    // @ts-ignore
    global.fetch = fetchMock;

    const first = await fetchHardwareExpectations("modelB");
    const second = await fetchHardwareExpectations("modelB");

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when required fields are missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nvidia_payload: { arch: "HOPPER", evidence_list: [] },
      }),
    });
    // @ts-ignore
    global.fetch = fetchMock;

    await expect(fetchHardwareExpectations("bad-model")).rejects.toThrow(/Missing expected/);
  });

  it("does not cache failed fetches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nvidia_payload: { arch: "HOPPER" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          nvidia_payload: mockPayload,
        }),
      });
    // @ts-ignore
    global.fetch = fetchMock;

    await expect(fetchHardwareExpectations("modelC")).rejects.toThrow();
    const result = await fetchHardwareExpectations("modelC");
    expect(result.nonce).toBe("n1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads expectations from nested model attestation payloads/info", async () => {
    const modelNode = {
      nvidia_payload: JSON.stringify({
        eat_nonce: "model-nonce",
        arch: "H200",
        measurements: [{ hash: "model-measurement" }],
      }),
      info: JSON.stringify({
        device_cert_hash: "model-device-hash",
        rim: "model-rim",
        ueid: "model-ueid",
      }),
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nvidia_payload: {
          model_attestations: [modelNode],
        },
      }),
    });
    // @ts-ignore
    global.fetch = fetchMock;

    const expectations = await fetchHardwareExpectations("modelNested");
    expect(expectations).toEqual({
      nonce: "model-nonce",
      arch: "H200",
      deviceCertHash: "model-device-hash",
      rimHash: "model-rim",
      ueid: "model-ueid",
      measurements: ["model-measurement"],
    });
  });
});
