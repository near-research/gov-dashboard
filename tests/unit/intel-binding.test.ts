import { describe, it, expect } from "vitest";
import { validateIntelBinding } from "@/utils/verification/intel";

const sampleNonce =
  "4d6e0c49321d22daa9bd7fc2205e381f9506c20e77dd5082ecf5e124ec0f4618";
const sampleAddress = "0x319f1b8bb3b723a5d098ffb67005bdf7bb579aca";

describe("validateIntelBinding", () => {
  it("returns true when report_data contains nonce and signing address", () => {
    const result = validateIntelBinding(
      {
        report_data: `nonce=${sampleNonce};signer=${sampleAddress}`,
      },
      sampleNonce,
      [sampleAddress]
    );
    expect(result.nonceMatch).toBe(true);
    expect(result.signingMatch).toBe(true);
  });

  it("accepts base64-encoded report_data containing nonce and signing address", () => {
    const encoded = Buffer.from(
      `nonce=${sampleNonce};signer=${sampleAddress}`,
      "utf8"
    ).toString("base64");
    const result = validateIntelBinding(
      {
        report_data: encoded,
      },
      sampleNonce,
      [sampleAddress]
    );
    expect(result.nonceMatch).toBe(true);
    expect(result.signingMatch).toBe(true);
  });

  it("fails when nonce is missing from report_data", () => {
    const result = validateIntelBinding(
      {
        report_data: `signer=${sampleAddress}`,
      },
      sampleNonce,
      [sampleAddress]
    );
    expect(result.nonceMatch).toBe(false);
  });

  it("fails when signing address is not embedded", () => {
    const result = validateIntelBinding(
      {
        report_data: `nonce=${sampleNonce};signer=0x0000`,
      },
      sampleNonce,
      [sampleAddress]
    );
    expect(result.signingMatch).toBe(false);
  });

  it("fails when nonce in report_data does not match expected", () => {
    const tamperedNonce = "f".repeat(64);
    const result = validateIntelBinding(
      { report_data: `nonce=${tamperedNonce};signer=${sampleAddress}` },
      sampleNonce,
      [sampleAddress]
    );
    expect(result.nonceMatch).toBe(false);
  });

  it("fails when signing address in report_data does not match attested", () => {
    const result = validateIntelBinding(
      { report_data: `nonce=${sampleNonce};signer=0x1111111111111111111111111111111111111111` },
      sampleNonce,
      [sampleAddress]
    );
    expect(result.signingMatch).toBe(false);
  });
});
