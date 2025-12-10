import type { WalletInterface } from "near-sign-verify";
import { sign } from "near-sign-verify";
import { siwnRecipient } from "@/config/siwn";
import type { NearAIVerificationOptions } from "@/lib/near-ai/types";

export interface VerificationAuthTokenParams {
  walletSigner: WalletInterface;
  verificationId?: string;
  recipient?: string;
}

export async function createVerificationAuthToken({
  walletSigner,
  verificationId,
  recipient,
}: VerificationAuthTokenParams): Promise<string> {
  const message = verificationId
    ? `Fetch verification proof ${verificationId}`
    : "Fetch verification proof";
  return sign(message, {
    signer: walletSigner,
    recipient: recipient ?? siwnRecipient,
  });
}

export function buildVerificationHeaders(
  options?: NearAIVerificationOptions
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!options) return headers;
  if (options.verificationId) {
    headers["X-Verification-Id"] = options.verificationId;
  }
  if (options.verificationNonce) {
    headers["X-Nonce"] = options.verificationNonce;
  }
  if (options.requestHash) {
    headers["X-Request-Hash"] = options.requestHash;
  }
  if (options.responseHash) {
    headers["X-Response-Hash"] = options.responseHash;
  }
  if (options.signingAlgo) {
    headers["X-Verification-Signing-Algo"] = options.signingAlgo;
  }
  if (options.extraHeaders) {
    Object.entries(options.extraHeaders).forEach(([key, value]) => {
      if (value) {
        headers[key] = value;
      }
    });
  }
  return headers;
}
