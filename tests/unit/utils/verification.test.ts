import { describe, it, expect } from "vitest";
import {
  toVerificationStatus,
  shortenFingerprint,
  extractVerificationMetadata,
  normalizeVerificationPayload,
} from "@/verification/normalize";

describe("toVerificationStatus", () => {
  it("normalizes verified/valid", () => {
    expect(toVerificationStatus("verified")).toBe("verified");
    expect(toVerificationStatus("valid")).toBe("verified");
  });
  it("normalizes failed/invalid", () => {
    expect(toVerificationStatus("failed")).toBe("failed");
    expect(toVerificationStatus("invalid")).toBe("failed");
  });
  it("defaults to pending for empty inputs", () => {
    expect(toVerificationStatus()).toBe("pending");
    expect(toVerificationStatus("")).toBe("pending");
  });
  it("returns unknown for unrecognized values", () => {
    expect(toVerificationStatus("unknown")).toBe("unknown");
    expect(toVerificationStatus("foo")).toBe("unknown");
  });
});

describe("shortenFingerprint", () => {
  it("returns full value when short", () => {
    expect(shortenFingerprint("abc", 2)).toBe("abc");
  });
  it("shortens long values", () => {
    expect(shortenFingerprint("abcdefgh", 2)).toBe("ab…gh");
  });
});

describe("extractVerificationMetadata", () => {
  const baseProof = { proof: "p", signature: "s", attestation_report: "r" };

  it("extracts from payload.verification", () => {
    const payload = {
      verification: {
        status: "verified",
        message_id: "m1",
        proof: "p1",
      },
    };
    const meta = extractVerificationMetadata(payload);
    expect(meta?.status).toBe("verified");
    expect(meta?.messageId).toBe("m1");
    expect(meta?.proof).toBe("p1");
  });

  it("extracts from metadata and envelope", () => {
    const payload = {
      metadata: { verification: { status: "failed", message_id: "mid" } },
      ...baseProof,
    };
    const envelope = { verification: { status: "verified", message_id: "env" } };
    const meta = extractVerificationMetadata(payload, envelope);
    expect(meta?.status).toBe("failed");
    expect(meta?.messageId).toBe("mid");
    expect(meta?.attestationReport).toBe("r");
  });

  it("prefers near_metadata and handles signature/measurement", () => {
    const payload = {
      near_metadata: {
        verification: { status: "valid", message_id: "near-id", signature: "sigN" },
        attestation: { report: "reportN", measurement: "measureN" },
      },
      signature: "sigP",
      measurement: "measureP",
    };
    const meta = extractVerificationMetadata(payload);
    expect(meta?.status).toBe("verified");
    expect(meta?.messageId).toBe("near-id");
    expect(meta?.signature).toBe("sigP");
    expect(meta?.measurement).toBe("measureN");
  });

  it("handles envelope fallbacks and attestation URL", () => {
    const payload = {
      attestation: { url: "http://a", report: "rep" },
      metadata: {},
    };
    const envelope = { attestation: { url: "http://env", evidence: "ev" } };
    const meta = extractVerificationMetadata(payload, envelope);
    expect(meta?.attestationUrl).toBe("http://a");
    expect(meta?.attestationReport).toBe("rep");
  });

  it("returns undefined when no verification data", () => {
    expect(extractVerificationMetadata({})).toBeUndefined();
  });
});

describe("normalizeVerificationPayload", () => {
  it("creates pending when none provided but id present", () => {
    const { verification, verificationId } = normalizeVerificationPayload(undefined, "id1");
    expect(verification?.status).toBe("pending");
    expect(verificationId).toBe("id1");
  });

  it("adds messageId when missing", () => {
    const existing = { source: "near-ai-cloud" as const, status: "pending" as const };
    const { verification } = normalizeVerificationPayload(existing, "id2");
    expect(verification?.messageId).toBe("id2");
  });
});
