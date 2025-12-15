import { createHash } from "crypto";

/**
 * Compute SHA-256 hash of a string
 */
export function sha256sum(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Extract chat completion ID from SSE streaming response
 * The ID appears in the first data line: data: {"id":"chatcmpl-xxx",...}
 */
export function extractChatId(responseText: string): string | null {
  try {
    const lines = responseText.split("\n");
    const firstDataLine = lines.find((line) => line.startsWith("data: {"));

    if (!firstDataLine) return null;

    const json = JSON.parse(firstDataLine.substring(6)); // remove `data: `
    return json.id || null;
  } catch {
    return null;
  }
}

/**
 * Parse signature text into request and response hashes
 * Format: "requestHash:responseHash"
 */
export function parseSignatureText(
  text: string
): { requestHash: string; responseHash: string } | null {
  const parts = text.split(":");
  if (parts.length !== 2) return null;
  if (!parts[0] || !parts[1]) return null;
  return { requestHash: parts[0], responseHash: parts[1] };
}
