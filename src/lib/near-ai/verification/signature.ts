import { ethers } from "ethers";
import type {
  SignatureResponse,
  HashValidation,
  SignatureValidation,
} from "./types";

/**
 * Fetch signature for a chat completion from NEAR AI
 */
export async function fetchSignature(
  chatId: string,
  model: string,
  options?: {
    baseUrl?: string;
    apiKey?: string;
    timeout?: number;
  }
): Promise<SignatureResponse> {
  const baseUrl =
    options?.baseUrl || process.env.NEAR_AI_URL || "https://cloud-api.near.ai";
  const apiKey = options?.apiKey || process.env.NEAR_AI_CLOUD_API_KEY;

  if (!apiKey) {
    throw new Error("NEAR AI API key not configured");
  }

  const url = `${baseUrl}/v1/signature/${chatId}?model=${encodeURIComponent(
    model
  )}&signing_algo=ecdsa`;

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeout ?? 10000
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Signature fetch failed: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as SignatureResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Compare computed hashes against signed hashes from signature response
 */
export function compareHashes(
  signatureText: string,
  computedRequestHash: string,
  computedResponseHash: string
): HashValidation {
  const [signedRequestHash = "", signedResponseHash = ""] =
    signatureText.split(":");

  const requestHashMatch = signedRequestHash === computedRequestHash;
  const responseHashMatch = signedResponseHash === computedResponseHash;

  return {
    valid: requestHashMatch && responseHashMatch,
    requestHashMatch,
    responseHashMatch,
    signedRequestHash,
    signedResponseHash,
    computedRequestHash,
    computedResponseHash,
  };
}

/**
 * Verify ECDSA signature and check against TEE addresses
 *
 * @param message - The signed message (signature.text)
 * @param signature - The ECDSA signature
 * @param teeAddresses - List of valid TEE signing addresses from attestation
 */
export function verifySignature(
  message: string,
  signature: string,
  teeAddresses: string[]
): SignatureValidation {
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);

    // Check if recovered address is in TEE addresses list (case-insensitive)
    const teeAttested =
      teeAddresses.length === 0
        ? false
        : teeAddresses.some(
            (addr) => addr.toLowerCase() === recoveredAddress.toLowerCase()
          );

    // Signature is only valid if:
    // 1. We have TEE addresses AND recovered address is in the list, OR
    // 2. We have no TEE addresses (attestation skipped) - signature is technically valid but not TEE-attested
    const valid = teeAddresses.length === 0 || teeAttested;

    return {
      valid,
      recoveredAddress,
      expectedAddresses: teeAddresses,
      teeAttested,
    };
  } catch (error) {
    return {
      valid: false,
      recoveredAddress: null,
      expectedAddresses: teeAddresses,
      teeAttested: false,
      error:
        error instanceof Error
          ? error.message
          : "Signature verification failed",
    };
  }
}
