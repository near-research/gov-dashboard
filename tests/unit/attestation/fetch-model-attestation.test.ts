import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchModelAttestation } from "@/utils/attestation/fetch-model-attestation";

describe("fetchModelAttestation", () => {
  const originalFetch = global.fetch;
  const model = "deepseek-ai/DeepSeek V3.1";

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requests attestation/report with signing_algo and fresh nonce", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    global.fetch = fetchSpy as any;

    const result = await fetchModelAttestation(model);

    const nonce = result?.nonce;
    expect(nonce).toHaveLength(64);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchSpy.mock.calls[0] ?? [])[0] as string;
    expect(calledUrl).toContain(
      "/v1/attestation/report?model=deepseek-ai%2FDeepSeek%20V3.1&signing_algo=ecdsa&nonce="
    );
    expect(calledUrl).toContain(`nonce=${nonce}`);
    expect(result?.nonce).toBe(nonce);
    expect(result?.attestation).toEqual({ ok: true });
  });
});
