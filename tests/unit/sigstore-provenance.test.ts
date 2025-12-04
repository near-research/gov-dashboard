import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractComposeImageDigests,
  verifyComposeProvenance,
  __sigstoreTestHooks,
} from "@/utils/verification/sigstore";

describe("sigstore provenance", () => {
  beforeEach(() => {
    (globalThis as any).__sigstoreVerifyMock = vi.fn(async () => ({}));
    __sigstoreTestHooks.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).__sigstoreVerifyMock;
  });

  it("extracts image digests from compose manifest", () => {
    const manifest = `
services:
  api:
    image: nearaidev/cloud-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  worker:
    image: other/image@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
`;
    const digests = extractComposeImageDigests(manifest);
    expect(digests).toHaveLength(2);
  });

  it("fails when provenance is missing", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
    } as any);

    const result = await verifyComposeProvenance(
      "image: nearaidev/cloud-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    expect(result.verified).toBe(false);
    expect(result.reasons[0]).toContain("Missing Sigstore provenance");
  });

  it("passes when provenance matches expectations", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        repository: "near/nearai-cloud-api",
        tag: "v1.0.0",
        workflow: "release.yml",
      }),
    } as any);

    const result = await verifyComposeProvenance(
      "image: nearaidev/cloud-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    expect(result.verified).toBe(true);
  });

  it("fails when repository or workflow mismatches", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        repository: "unexpected/repo",
        tag: "v1.0.0",
        workflow: "unexpected.yml",
      }),
    } as any);

    const result = await verifyComposeProvenance(
      "image: nearaidev/cloud-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    expect(result.verified).toBe(false);
    expect(result.reasons.some((r) => r.includes("Repository mismatch"))).toBe(
      true
    );
    expect(result.reasons.some((r) => r.includes("Workflow mismatch"))).toBe(
      true
    );
  });

  it("uses cache for repeated digests", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        repository: "near/nearai-cloud-api",
        tag: "v1.0.0",
        workflow: "release.yml",
      }),
    } as any);

    const manifest =
      "image: nearaidev/cloud-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const first = await verifyComposeProvenance(manifest);
    const second = await verifyComposeProvenance(manifest);
    expect(first.verified).toBe(true);
    expect(second.verified).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__sigstoreTestHooks.cacheSize()).toBeGreaterThan(0);
  });
});
