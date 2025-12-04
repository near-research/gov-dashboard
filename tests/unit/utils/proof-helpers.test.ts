import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { verifyNRASJWT } from "@/utils/verification/proof-helpers";

const base64Url = (value: string) =>
  Buffer.from(value).toString("base64url");

const future = Math.floor(Date.now() / 1000) + 60;
const past = Math.floor(Date.now() / 1000) - 60;
const goodNonce = "abc123";

const buildToken = (payloadOverrides: Record<string, any> = {}) => {
  const header = base64Url(JSON.stringify({ alg: "ES256" }));
  const payload = base64Url(
    JSON.stringify({
      iss: "https://nras.attestation.nvidia.com",
      exp: future,
      nbf: past,
      "x-nvidia-overall-att-result": true,
      "x-nvidia-eat-nonce": goodNonce,
      ...payloadOverrides,
    })
  );
  const signature = "signature";
  return `${header}.${payload}.${signature}`;
};

describe("verifyNRASJWT", () => {
  const originalAtob = globalThis.atob;
  beforeAll(() => {
    // polyfill atob for Node env
    if (typeof atob === "undefined") {
      (globalThis as any).atob = (data: string) =>
        Buffer.from(data, "base64").toString("binary");
    }
  });

  afterAll(() => {
    if (!originalAtob) {
      // @ts-ignore
      delete (globalThis as any).atob;
    }
  });

  it("returns true when nonce matches and claims valid", () => {
    const token = buildToken();
    expect(verifyNRASJWT(token, goodNonce)).toBe(true);
  });

  it("returns false when nonce mismatches", () => {
    const token = buildToken({ "x-nvidia-eat-nonce": "other" });
    expect(verifyNRASJWT(token, goodNonce)).toBe(false);
  });

  it("returns false when issuer invalid", () => {
    const token = buildToken({ iss: "https://example.com" });
    expect(verifyNRASJWT(token, goodNonce)).toBe(false);
  });

  it("returns false when expired", () => {
    const token = buildToken({ exp: past - 10 });
    expect(verifyNRASJWT(token, goodNonce)).toBe(false);
  });
});
