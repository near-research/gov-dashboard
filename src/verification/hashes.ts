import { createHash } from "crypto";
import { extractHashesFromSignedText, validateHashPair } from "./hash-utils";

const sha256 = (input: string): string =>
  createHash("sha256").update(Buffer.from(input, "utf8")).digest("hex");

const requireRawString = (body: unknown): string => {
  if (typeof body !== "string") {
    throw new TypeError(
      "calculateRequestHash expects the exact serialized request string (no JSON.stringify)."
    );
  }
  return body;
};

/**
 * Calculates SHA-256 hash of the exact request body.
 * Requires the already-serialized JSON string to avoid mutation from JSON.stringify.
 */
export const calculateRequestHash = (body: string): string => {
  const payload = requireRawString(body);
  return sha256(payload);
};

export const calculateResponseHash = (responseText: string): string => {
  return sha256(responseText);
};

/**
 * Calculates a hash for SSE streaming responses.
 * The input should be the raw text exactly as received (including blank lines).
 */
export const calculateStreamingHash = (sseText: string): string => {
  // Do NOT trim; trailing newlines are required per NEAR AI docs.
  return calculateResponseHash(sseText);
};

export { extractHashesFromSignedText, validateHashPair };

export const computeRequestHash = calculateRequestHash;

export const computeHash = (input: string): string => sha256(input);
