import { extractHashesFromSignedText, validateHashPair } from "./hash-utils";

const textEncoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const digest = async (input: string) => {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto not available for hashing");
  }
  const data = textEncoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash);
};

const requireRawString = (body: unknown): string => {
  if (typeof body !== "string") {
    throw new TypeError(
      "calculateRequestHash expects the exact serialized request string (no JSON.stringify)."
    );
  }
  return body;
};

export const calculateRequestHash = async (body: string) => {
  const payload = requireRawString(body);
  return digest(payload);
};

export const calculateResponseHash = async (responseText: string) => {
  return digest(responseText);
};

export const calculateStreamingHash = async (sseText: string) => {
  return calculateResponseHash(sseText);
};

export { extractHashesFromSignedText, validateHashPair };
