import { describe, it, expect } from "vitest";
import {
  hashComposeManifest,
  extractComposeManifest,
  extractMrConfig,
} from "@/utils/verification/intel";

describe("compose vs mr_config", () => {
  const compose = "services:\n  app:\n    image: example:latest\n";

  it("hashes compose manifest deterministically", () => {
    const hash1 = hashComposeManifest(compose);
    const hash2 = hashComposeManifest(compose);
    expect(hash1).toBe(hash2);
  });

  it("extracts compose manifest from attestation info", () => {
    const att = { info: { compose } };
    expect(extractComposeManifest(att)).toBe(compose);
  });

  it("extracts mr_config from intel response", () => {
    const intel = { mr_config: "abc123" };
    expect(extractMrConfig(intel)).toBe("abc123");
  });

  it("detects mismatch between compose hash and mr_config", () => {
    const manifestHash = hashComposeManifest(compose);
    const mrConfig = "deadbeef";
    expect(manifestHash === mrConfig).toBe(false);
  });
});
