import {
  createPublicKey as nodeCreatePublicKey,
  verify as nodeVerify,
  KeyObject,
} from "crypto";

type CryptoImpl = {
  createPublicKey?: typeof nodeCreatePublicKey;
  verify?: typeof nodeVerify;
};

declare global {
  interface GlobalThis {
    __moduleMocks?: Map<string, CryptoImpl>;
  }
}

type GlobalWithMocks = typeof globalThis & {
  __moduleMocks?: Map<string, CryptoImpl>;
};

type NodeJsonWebKey = import("crypto").JsonWebKey;

const getCryptoImpl = (): CryptoImpl => {
  const mocks = (globalThis as GlobalWithMocks).__moduleMocks;
  const mockedCrypto =
    mocks?.get("crypto") ?? mocks?.get("@/server/crypto");
  // Preserve mocks until explicitly cleared so both createPublicKey and verify
  // can share the same mock implementation in tests.
  return mockedCrypto ?? {
    createPublicKey: nodeCreatePublicKey,
    verify: nodeVerify,
  };
};

type SupportedAlg = "ES256" | "ES384";

export function createPublicKey(jwk: JsonWebKey): KeyObject {
  try {
    // Node accepts the JsonWebKey directly even if DOM typings differ
    const impl = getCryptoImpl().createPublicKey ?? nodeCreatePublicKey;
    const nodeJwk = jwk as unknown as NodeJsonWebKey;
    return impl({ key: nodeJwk, format: "jwk" });
  } catch (error) {
    throw new Error(
      `Invalid JWK: ${(error as Error)?.message || "unable to create public key"}`
    );
  }
}

export function verify(
  alg: SupportedAlg,
  data: Buffer | string,
  publicKey: KeyObject,
  signature: Buffer
): boolean {
  const hashAlg = alg === "ES256" ? "sha256" : "sha384";

  try {
    const impl = getCryptoImpl().verify ?? nodeVerify;
    return impl(hashAlg, typeof data === "string" ? Buffer.from(data) : data, publicKey, signature);
  } catch (error) {
    throw new Error(
      `Signature verification failed: ${(error as Error)?.message || "unknown error"}`
    );
  }
}
