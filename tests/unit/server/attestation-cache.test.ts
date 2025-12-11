import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as attestationCache from "@/server/attestation-cache";
import * as fetchModel from "@/utils/attestation/fetch-model-attestation";
import { __attestationCacheTestHooks } from "@/server/attestation-cache";
import { mockAddress } from "../../fixtures/verification";

const mockFetchModel = vi.spyOn(fetchModel, "fetchModelAttestation");

describe("attestation-cache verification", () => {
  const originalFetch = global.fetch;
  const originalIntelUrl = process.env.INTEL_TDX_ATTESTATION_URL;
  const originalIntelKey = process.env.INTEL_TDX_API_KEY;
  const nonce = "a".repeat(64);

  const buildAttestation = () => ({
    gateway_attestation: {
      request_nonce: nonce,
      signing_address: "0x2016F58821aF58cbdfffdE6955dDb76F18f1b358",
      intel_quote: { report_data: `nonce:${nonce}` },
      event_log: JSON.stringify([
        {
          device_cert_hash: "devhash",
          rim: "rimhash",
          ueid: "ueid",
        },
      ]),
    },
    model_attestations: [
      {
        signing_address: "0x2016F58821aF58cbdfffdE6955dDb76F18f1b358",
        intel_quote: { report_data: `nonce:${nonce}` },
        event_log: JSON.stringify([
          {
            measurements: ["m1"],
            device_cert_hash: "devhash",
            rim: "rimhash",
            ueid: "ueid",
          },
        ]),
        nvidia_payload: JSON.stringify({
          nonce,
          arch: "HOPPER",
          evidence_list: [{}],
          device_cert_hash: "devhash",
          rim: "rimhash",
          ueid: "ueid",
          measurements: ["m1"],
        }),
      },
    ],
  });

  beforeEach(() => {
    mockFetchModel.mockReset();
    __attestationCacheTestHooks.clear();
    process.env.INTEL_TDX_ATTESTATION_URL = "https://intel.example";
    process.env.INTEL_TDX_API_KEY = "fake-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.INTEL_TDX_ATTESTATION_URL = originalIntelUrl;
    process.env.INTEL_TDX_API_KEY = originalIntelKey;
  });

  it("caches expectations only when NRAS and Intel verification succeed", async () => {
    mockFetchModel.mockResolvedValue({ attestation: buildAttestation(), nonce, signingAlgo: "ecdsa" });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("nras.attestation.nvidia.com")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            verified: true,
            claims: {
              "x-nvidia-overall-att-result": true,
              "x-nvidia-gpu-attestation-report-signature-verified": true,
              "x-nvidia-gpu-attestation-report-nonce-match": true,
              secboot: true,
              measres: "success",
              "x-nvidia-eat-nonce": nonce,
            },
          }),
        } as any);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          verified: true,
          nonce,
          report_data: `nonce:${nonce} ${mockAddress}`,
        }),
      } as any);
    });

    const expectations = await attestationCache.getModelExpectations("deepseek-ai/DeepSeek-V3.1");
    expect(expectations).not.toBeNull();
    expect(expectations!.nonce).toBe(nonce);
    expect(attestationCache.getCachedAttestation("deepseek-ai/DeepSeek-V3.1")).toBeTruthy();
  });

  it("does not cache when NRAS verification fails", async () => {
    mockFetchModel.mockResolvedValue({ attestation: buildAttestation(), nonce, signingAlgo: "ecdsa" });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        verified: false,
        claims: { "x-nvidia-eat-nonce": "deadbeef" },
      }),
    } as any);

    await expect(
      attestationCache.getModelExpectations("deepseek-ai/DeepSeek-V3.1")
    ).rejects.toThrow();
    expect(attestationCache.getCachedAttestation("deepseek-ai/DeepSeek-V3.1")).toBeNull();
  });
});
