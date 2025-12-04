import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyComposeProvenance, __sigstoreTestHooks } from "@/utils/verification/sigstore";

const mockVerify = vi.fn();

vi.mock("@sigstore/verify", () => ({
  verify: (...args: any[]) => mockVerify(...args),
}));

const buildProvenanceResponse = (digest: string) => {
  const sha = digest.split("sha256:")[1];
  const payload = {
    subject: [{ name: "nearaidev/cloud-api", digest: { sha256: sha } }],
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return {
    repository: "near/nearai-cloud-api",
    tag: "v1.0.0",
    workflow: "release.yml",
    bundle: {
      verification_result: "VERIFIED",
      dsseEnvelope: {
        payload: payloadB64,
        signatures: [{}],
      },
    },
  };
};

describe("verifyComposeProvenance", () => {
  const originalFetch = global.fetch;

beforeEach(() => {
  mockVerify.mockReset();
  __sigstoreTestHooks.clearCache();
  __sigstoreTestHooks.setVerifier(mockVerify as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  __sigstoreTestHooks.setVerifier(null as any);
});

  it("verifies provenance with sigstore verifier when bundle is valid", async () => {
    const digest = `nearaidev/cloud-api@sha256:${"a".repeat(64)}`;
    const provenance = buildProvenanceResponse(digest);
    mockVerify.mockResolvedValue({});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => provenance,
    } as any);

    const result = await verifyComposeProvenance(`service:\n  image: ${digest}`);

    expect(result.verified).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(mockVerify).toHaveBeenCalledWith(provenance.bundle);
    expect(__sigstoreTestHooks.cacheSize()).toBe(1);
  });

  it("fails when sigstore verification rejects", async () => {
    const digest = `nearaidev/cloud-api@sha256:${"b".repeat(64)}`;
    const provenance = buildProvenanceResponse(digest);
    mockVerify.mockRejectedValue(new Error("bad sig"));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => provenance,
    } as any);

    const result = await verifyComposeProvenance(`service:\n  image: ${digest}`);

    expect(result.verified).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes("bad sig"))).toBe(true);
    expect(__sigstoreTestHooks.cacheSize()).toBe(0);
  });
});
