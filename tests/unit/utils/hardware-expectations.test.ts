import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractHardwareExpectations,
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

  it("extracts expectations from attestation wrappers hiding fields", async () => {
    const wrappedPayload = {
      nvidia_payload: {
        model_attestations: [
          {
            attestation: {
              nvidia_payload: JSON.stringify({
                nonce: "nested-nonce",
                arch: "H200",
                measurements: ["nested-measurement"],
              }),
              info: JSON.stringify({
                device_cert_hash: "nested-device",
                rim: "nested-rim",
                ueid: "nested-ueid",
              }),
            },
          },
        ],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => wrappedPayload,
    });
    // @ts-ignore
    global.fetch = fetchMock;

    const expectations = await fetchHardwareExpectations("attestationWrapper");
    expect(expectations).toEqual({
      nonce: "nested-nonce",
      arch: "H200",
      deviceCertHash: "nested-device",
      rimHash: "nested-rim",
      ueid: "nested-ueid",
      measurements: ["nested-measurement"],
    });
  });

  it("parses expectations from event log text when structured data is missing", () => {
    const logEntry = {
      event_payload:
        "nonce:event-nonce arch:H800 device_cert_hash:event-device measurements:sha256:abc",
    };
    const payload = {
      gateway_attestation: {
        event_log: JSON.stringify([logEntry]),
      },
      model_attestations: [
        {
          event_log: JSON.stringify([logEntry]),
        },
      ],
    };

    const expectations = extractHardwareExpectations(payload);
    expect(expectations).toMatchObject({
      nonce: "event-nonce",
      arch: "H800",
      measurements: expect.arrayContaining(["sha256:abc"]),
    });
  });

  it("extracts Intel expectations from gateway attestation info and event log", () => {
    const intelPayload = {
      gateway_attestation: {
        request_nonce: "intel-nonce",
        info: {
          mr_aggregated: "mr-agg",
          compose_hash: "comp-hash",
          os_image_hash: "os-hash",
          instance_id: "instance-id",
        },
        event_log: JSON.stringify([
          { event: "mr-kms", event_payload: "0x6d722d6b" },
          { event: "compose-hash", event_payload: "0x636f6d70" },
        ]),
      },
    };

    const expectations = extractHardwareExpectations(intelPayload);
    expect(expectations).toMatchObject({
      nonce: "intel-nonce",
      arch: "intel-tdx",
      deviceCertHash: "comp-hash",
      rimHash: "os-hash",
      ueid: "instance-id",
    });
    expect(expectations.measurements).toEqual(
      expect.arrayContaining(["mr-agg", "comp-hash", "os-hash", "6d722d6b", "636f6d70"])
    );
  });
});
