import { describe, it, expect } from "vitest";
import {
  extractExpectationsFromMessage,
  validateExpectations,
} from "@/utils/attestation/expectations";

describe("attestation-expectations edge cases", () => {
  it("flags missing required fields in validation message", () => {
    const result = validateExpectations({});
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([
      "nonce",
      "arch",
      "deviceCertHash",
      "measurements",
    ]);
    expect(result.message).toMatch(/Missing expectations/);
  });

  it("extracts rim hash and measurements from nested nvidia payload string", () => {
    const message = {
      proof: {
        nvidia_payload: JSON.stringify({
          nonce: "n1",
          arch: "HOPPER",
          device_cert_hash: "abc",
          rim: "rim123",
          expected_measurements: ["m1"],
        }),
      },
    };

    const expectations = extractExpectationsFromMessage(message);
    expect(expectations.rimHash).toBe("rim123");
    expect(expectations.measurements).toEqual(["m1"]);
  });

  it("extracts fields from gateway/model attestation payloads when top-level missing", () => {
    const message = {
      proof: {
        gateway_attestation: {
          nvidia_payload: {
            nonce: "ng",
            arch: "ADA",
            device_cert_hash: "g-hash",
            expectedMeasurements: "mg1",
          },
        },
        model_attestations: [
          {
            nvidia_payload: {
              nonce: "nm",
              arch: "HOPPER",
              device_cert_hash: "m-hash",
              rim: "rim-m",
              expected_measurements: ["mm1", "mm2"],
            },
          },
        ],
      },
    };

    const expectations = extractExpectationsFromMessage(message);
    expect(expectations.nonce).toBe("nm"); // model attestation takes priority
    expect(expectations.arch).toBe("HOPPER");
    expect(expectations.deviceCertHash).toBe("m-hash");
    expect(expectations.rimHash).toBe("rim-m");
    expect(expectations.measurements).toEqual(["mm1", "mm2"]);
  });
});
