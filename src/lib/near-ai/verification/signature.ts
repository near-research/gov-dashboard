import { ethers } from "ethers";
import { logger } from "@/lib/logger";
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

    const signatureData = (await response.json()) as SignatureResponse;
    logger.debug("[Agent] Signature fetched", {
      chatId,
      signingAddress: signatureData.signing_address,
      signingAlgo: signatureData.signing_algo,
      hasSignature: Boolean(signatureData.signature),
    });
    return signatureData;
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
 * @param signingAddress - Claimed signer address from NEAR AI
 */
export function verifySignature(
  message: string,
  signature: string,
  teeAddresses: string[],
  signingAddress: string
): SignatureValidation {
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    const normalizedSigningAddress = signingAddress
      ? signingAddress.toLowerCase()
      : "";

    // Cryptographic validity: did the recovered address match the claimed signer?
    const signatureValid =
      !!normalizedSigningAddress &&
      recoveredAddress.toLowerCase() === normalizedSigningAddress;

    const teeAttested = Boolean(
      normalizedSigningAddress &&
        teeAddresses.some(
          (addr) => addr.toLowerCase() === normalizedSigningAddress
        )
    );

    return {
      valid: signatureValid,
      recoveredAddress,
      signingAddress,
      teeAddresses,
      teeAttested,
    };
  } catch (error) {
    return {
      valid: false,
      recoveredAddress: null,
      signingAddress,
      teeAddresses,
      teeAttested: false,
      error:
        error instanceof Error
          ? error.message
          : "Signature verification failed",
    };
  }
}
