import { describe, it, expect } from "vitest";
import {
  validateExpectations,
  isCompleteExpectations,
  extractExpectationsFromMessage,
  extractExpectationsFromProposal,
} from "@/utils/attestation-expectations";
import type { AttestationExpectations, PartialExpectations } from "@/utils/attestation-expectations";

const fullExpectations: AttestationExpectations = {
  nonce: "abc",
  arch: "HOPPER",
  deviceCertHash: "devhash",
  rimHash: "rimhash",
  ueid: "ueid123",
  measurements: ["m1", "m2"],
};

describe("validateExpectations", () => {
  it("returns complete:true when required fields present", () => {
    const res = validateExpectations(fullExpectations);
    expect(res.complete).toBe(true);
    expect(res.missing).toHaveLength(0);
    expect(res.message).toBeUndefined();
  });

  it("returns complete:false when required field missing", () => {
    const keys: Array<keyof AttestationExpectations> = [
      "nonce",
      "arch",
      "deviceCertHash",
      "measurements",
    ];
    for (const key of keys) {
      const partial = { ...fullExpectations, [key]: key === "measurements" ? [] : undefined } as PartialExpectations;
      const res = validateExpectations(partial);
      expect(res.complete).toBe(false);
      expect(res.missing).toContain(key);
      expect(res.message).toContain("Missing expectations");
    }
  });

  it("identifies all missing fields in message", () => {
    const res = validateExpectations({ nonce: "123" });
    expect(res.complete).toBe(false);
    expect(res.missing).toEqual([
      "arch",
      "deviceCertHash",
      "measurements",
    ]);
  });

  it("handles empty measurements array as missing", () => {
    const res = validateExpectations({ ...fullExpectations, measurements: [] });
    expect(res.complete).toBe(false);
    expect(res.missing).toContain("measurements");
  });

  it("includes descriptive message for missing fields", () => {
    const res = validateExpectations({ arch: "HOPPER" });
    expect(res.message).toBe("Missing expectations: nonce, deviceCertHash, measurements");
  });
});

describe("isCompleteExpectations", () => {
  it("returns true as type guard for complete expectations", () => {
    const maybe: PartialExpectations = { ...fullExpectations };
    if (isCompleteExpectations(maybe)) {
      const accept = (v: AttestationExpectations) => v;
      expect(accept(maybe).arch).toBe("HOPPER");
    } else {
      throw new Error("Expected complete expectations");
    }
  });

  it("returns false for partial expectations", () => {
    expect(isCompleteExpectations({ nonce: "123" })).toBe(false);
    expect(isCompleteExpectations({ ...fullExpectations, measurements: [] })).toBe(false);
  });
});

describe("extractExpectationsFromMessage", () => {
  it("extracts from message.verification", () => {
    const res = extractExpectationsFromMessage({ verification: fullExpectations });
    expect(res.arch).toBe("HOPPER");
  });

  it("extracts from message.proof", () => {
    const res = extractExpectationsFromMessage({
      proof: { eat_nonce: "n1", gpu_arch: "H100", device_cert_hash: "d1", rim: "r1", ueid: "u1", measurements: ["m1"] },
    });
    expect(res.nonce).toBe("n1");
    expect(res.arch).toBe("H100");
  });

  it("extracts from message.metadata.verification", () => {
    const res = extractExpectationsFromMessage({ metadata: { verification: fullExpectations } });
    expect(res.ueid).toBe("ueid123");
  });

  it("extracts from message.envelope", () => {
    const res = extractExpectationsFromMessage({ envelope: fullExpectations });
    expect(res.deviceCertHash).toBe("devhash");
  });

  it("extracts from direct message properties", () => {
    const res = extractExpectationsFromMessage({ ...fullExpectations });
    expect(res.rimHash).toBe("rimhash");
  });

  it("handles nvidia_payload as string (JSON)", () => {
    const payload = JSON.stringify({
      eat_nonce: "n2",
      gpu_arch: "H200",
      device_cert_hash: "d2",
      rim: "r2",
      ueid: "u2",
      measurements: ["mx"],
    });
    const res = extractExpectationsFromMessage({ proof: { nvidia_payload: payload } });
    expect(res.nonce).toBe("n2");
    expect(res.arch).toBe("H200");
    expect(res.measurements).toEqual(["mx"]);
  });

  it("handles nvidia_payload as object", () => {
    const res = extractExpectationsFromMessage({
      proof: {
        nvidia_payload: {
          eat_nonce: "n3",
          arch: "ARCH3",
          device_cert_hash: "d3",
          rim: "r3",
          ueid: "u3",
          measurements: "m3",
        },
      },
    });
    expect(res.nonce).toBe("n3");
    expect(res.arch).toBe("ARCH3");
    expect(res.measurements).toEqual(["m3"]);
  });

  it("prefers model_attestations[0] over gateway_attestation", () => {
    const res = extractExpectationsFromMessage({
      proof: {
        model_attestations: [
          { nvidia_payload: { eat_nonce: "model", gpu_arch: "GV100", ueid: "ux" } },
        ],
        gateway_attestation: {
          nvidia_payload: { eat_nonce: "gateway", gpu_arch: "OTHER", ueid: "gy" },
        },
      },
    });
    expect(res.nonce).toBe("model");
    expect(res.arch).toBe("GV100");
  });

  it("normalizes field names and measurements", () => {
    const res = extractExpectationsFromMessage({
      proof: {
        nvidia_payload: {
          eat_nonce: "norm",
          gpu_arch: "GH200",
          device_cert_hash: "dc",
          rim: "rh",
          ueid: "uu",
          measurements: "m-only",
        },
      },
    });
    expect(res.measurements).toEqual(["m-only"]);
    expect(res.nonce).toBe("norm");
  });
});

describe("extractExpectationsFromProposal", () => {
  it("extracts from proposal.verification", () => {
    const res = extractExpectationsFromProposal({ verification: fullExpectations });
    expect(res.arch).toBe("HOPPER");
  });

  it("extracts from proposal.metadata", () => {
    const res = extractExpectationsFromProposal({ metadata: { verification: fullExpectations } });
    expect(res.nonce).toBe("abc");
  });

  it("returns empty object for null/undefined input", () => {
    expect(extractExpectationsFromProposal(null)).toEqual({});
    expect(extractExpectationsFromProposal(undefined)).toEqual({});
  });

  it("prioritizes nested verification over direct properties", () => {
    const res = extractExpectationsFromProposal({
      verification: { nonce: "nested", arch: "A", deviceCertHash: "d", rimHash: "r", ueid: "u", measurements: ["m"] },
      arch: "outer",
    });
    expect(res.nonce).toBe("nested");
    expect(res.arch).toBe("A");
  });
});
