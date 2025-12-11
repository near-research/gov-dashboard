import { describe, it, expect } from "vitest";
import {
  decodeJwtPayload,
  normalizeHashValue,
} from "@/utils/verification/shared";

describe("decodeJwtPayload", () => {
  it("decodes valid JWT payload", () => {
    const payload = { sub: "test", exp: 12345 };
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const jwt = `header.${base64Payload}.signature`;

    const result = decodeJwtPayload(jwt);

    expect(result).toMatchObject(payload);
  });

  it("returns null for invalid JWT format", () => {
    const result = decodeJwtPayload("not-a-jwt");
    expect(result).toBeNull();
  });

  it("returns null for invalid base64", () => {
    const result = decodeJwtPayload("header.!!!invalid!!!.signature");
    expect(result).toBeNull();
  });

  it("returns null for non-JSON payload", () => {
    const base64 = Buffer.from("not json").toString("base64url");
    const result = decodeJwtPayload(`header.${base64}.signature`);
    expect(result).toBeNull();
  });
});

describe("normalizeHashValue", () => {
  it("returns lowercase hash", () => {
    expect(normalizeHashValue("ABC123")).toBe("abc123");
  });

  it("strips 0x prefix", () => {
    expect(normalizeHashValue("0xabc123")).toBe("abc123");
  });

  it("handles null/undefined", () => {
    expect(normalizeHashValue(null)).toBe("");
    expect(normalizeHashValue(undefined)).toBe("");
  });
});
