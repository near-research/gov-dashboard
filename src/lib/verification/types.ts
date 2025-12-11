/**
 * NEAR AI Cloud verification types
 */

export interface SignatureData {
  text: string; // "{requestHash}:{responseHash}"
  signature: string; // ECDSA signature
  signing_address: string;
  signing_algo?: string;
}

export interface HashValidationResult {
  valid: boolean;
  requestHashMatch: boolean;
  responseHashMatch: boolean;
  signedRequestHash: string;
  signedResponseHash: string;
  expectedRequestHash: string;
  expectedResponseHash: string;
  error?: string;
}

export interface SignatureValidationResult {
  valid: boolean;
  cryptographicallyValid: boolean;
  addressConsistent: boolean;
  teeAttested: boolean;
  recoveredAddress: string | null;
  claimedAddress: string;
  attestedAddresses: string[];
  error?: string;
}

export interface VerificationResult {
  verified: boolean;
  status: VerificationStatus;
  hashValidation: HashValidationResult | null;
  signatureValidation: SignatureValidationResult | null;
  chatId: string | null;
  requestHash: string;
  responseHash: string;
  signature: SignatureData | null;
  warnings: string[];
  error?: string;
  requestBody?: string;
  responseText?: string;
}

export type VerificationStatus = "verified" | "pending" | "failed";

export interface AttestationReport {
  model_attestations?: Array<{
    signing_address?: string;
    signingAddress?: string;
    nvidia_payload?: unknown;
    intel_quote?: string;
  }>;
  gateway_attestation?: {
    signing_address?: string;
    signingAddress?: string;
    intel_quote?: string;
  };
  signing_address?: string;
  signingAddress?: string;
}
