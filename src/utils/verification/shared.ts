export const normalizeHashValue = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed.toLowerCase() : null;
};

export const normalizeHashPair = (
  requestHash?: string | null,
  responseHash?: string | null
) => {
  const req = normalizeHashValue(requestHash);
  const res = normalizeHashValue(responseHash);
  return req && res ? `${req}:${res}` : null;
};

export const decodeJwtPayload = (token?: string | null) => {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;

  const decodeBase64 = (value: string) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof atob === "function") {
      return atob(normalized);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(normalized, "base64").toString("utf8");
    }
    throw new Error("No base64 decoder available");
  };

  try {
    const payload = decodeBase64(parts[1]);
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const validateHashPair = (
  requestHash: string | null | undefined,
  responseHash: string | null | undefined,
  signatureText: string | null | undefined
): boolean => {
  if (!requestHash || !responseHash || !signatureText) return false;
  const expected = `${requestHash}:${responseHash}`.trim().toLowerCase();
  const received = signatureText.trim().toLowerCase();
  return timingSafeEqual(expected, received);
};
