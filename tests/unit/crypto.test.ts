import { describe, it, expect, beforeEach } from "vitest";
import {
  createPublicKey as createPubFromJwk,
  verify as verifySignature,
} from "@/server/crypto";
import {
  generateKeyPairSync,
  createSign,
  KeyObject,
  createHash,
} from "crypto";

type Curve = "P-256" | "P-384";

const genKeyPair = (curve: Curve) => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: curve,
  });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  return { jwk, privateKey, publicKey };
};

const signData = (
  data: Buffer | string,
  privateKey: KeyObject,
  hashAlg: "sha256" | "sha384"
) => {
  const signer = createSign(hashAlg);
  signer.update(data);
  signer.end();
  return signer.sign(privateKey);
};

describe("crypto utils", () => {
  beforeEach(() => {
    (globalThis as any).__moduleMocks?.clear?.();
  });

  it("creates public key from ES256 JWK (P-256 curve)", () => {
    const { jwk } = genKeyPair("P-256");
    const pub = createPubFromJwk(jwk);
    expect(pub.type).toBe("public");
  });

  it("creates public key from ES384 JWK (P-384 curve)", () => {
    const { jwk } = genKeyPair("P-384");
    const pub = createPubFromJwk(jwk);
    expect(pub.type).toBe("public");
  });

  it("verifies valid ECDSA signature with ES256", () => {
    const { jwk, privateKey } = genKeyPair("P-256");
    const pub = createPubFromJwk(jwk);
    const data = "hello world";
    const sig = signData(data, privateKey, "sha256");
    expect(verifySignature("ES256", data, pub, sig)).toBe(true);
  });

  it("verifies valid ECDSA signature with ES384", () => {
    const { jwk, privateKey } = genKeyPair("P-384");
    const pub = createPubFromJwk(jwk);
    const data = Buffer.from("hello world");
    const sig = signData(data, privateKey, "sha384");
    expect(verifySignature("ES384", data, pub, sig)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const { jwk, privateKey } = genKeyPair("P-256");
    const pub = createPubFromJwk(jwk);
    const data = "hello world";
    const sig = signData(data, privateKey, "sha256");
    // flip a byte
    sig[0] ^= 0xff;
    expect(verifySignature("ES256", data, pub, sig)).toBe(false);
  });

  it("rejects signature from wrong public key", () => {
    const { privateKey } = genKeyPair("P-256");
    const { jwk: jwkB } = genKeyPair("P-256");
    const pubB = createPubFromJwk(jwkB);
    const data = "hello world";
    const sig = signData(data, privateKey, "sha256");
    expect(verifySignature("ES256", data, pubB, sig)).toBe(false);
  });

  it("throws on malformed JWK", () => {
    expect(() =>
      // missing x/y
      createPubFromJwk({ kty: "EC" } as JsonWebKey)
    ).toThrow();
  });

  it("accepts data as Buffer or string", () => {
    const { jwk, privateKey } = genKeyPair("P-256");
    const pub = createPubFromJwk(jwk);
    const dataStr = "near-ai";
    const sig = signData(dataStr, privateKey, "sha256");
    expect(verifySignature("ES256", dataStr, pub, sig)).toBe(true);
    expect(verifySignature("ES256", Buffer.from(dataStr), pub, sig)).toBe(true);
  });

  it("uses sha256 for ES256 and sha384 for ES384", () => {
    const { jwk: jwk256, privateKey: pk256 } = genKeyPair("P-256");
    const pub256 = createPubFromJwk(jwk256);
    const data = "algo-check";

    const sigSha384 = signData(data, pk256, "sha384");
    expect(verifySignature("ES256", data, pub256, sigSha384)).toBe(false);

    const { jwk: jwk384, privateKey: pk384 } = genKeyPair("P-384");
    const pub384 = createPubFromJwk(jwk384);
    const sigSha256 = signData(data, pk384, "sha256");
    expect(verifySignature("ES384", data, pub384, sigSha256)).toBe(false);
  });
});
