/**
 * Response from NEAR AI /v1/signature/{chat_id} endpoint
 */
export interface SignatureResponse {
  /** Format: "requestHash:responseHash" */
  text: string;
  /** ECDSA signature: "0x..." */
  signature: string;
  /** TEE signing address */
  signing_address: string;
  /** Signing algorithm (always "ecdsa") */
  signing_algo: string;
}

/**
 * Result of comparing computed hashes against signed hashes
 */
export interface HashValidation {
  valid: boolean;
  requestHashMatch: boolean;
  responseHashMatch: boolean;
  signedRequestHash: string;
  signedResponseHash: string;
  computedRequestHash: string;
  computedResponseHash: string;
}

/**
 * Result of ECDSA signature verification
 */
export interface SignatureValidation {
  valid: boolean;
  recoveredAddress: string | null;
  signingAddress: string | null;
  teeAddresses: string[];
  /** Whether the recovered address is in the TEE attestation list */
  teeAttested: boolean;
  error?: string;
}

/**
 * NVIDIA attestation verification info
 */
export interface NvidiaVerificationInfo {
  /** Whether NVIDIA verification was performed */
  performed: boolean;
  /** Number of payloads verified */
  payloadCount: number;
  /** Whether all payloads passed verification */
  allPassed: boolean;
  /** Individual results (if verification was performed) */
  results?: Array<{
    verified: boolean;
    overallResult: boolean;
    error?: string;
  }>;
  /** Error if verification was skipped due to error */
  error?: string;
}

/**
 * Attestation information included in verification result
 */
export interface AttestationInfo {
  /** Whether attestation was fetched successfully */
  fetched: boolean;
  /** List of valid TEE signing addresses from attestation report */
  teeAddresses: string[];
  /** Whether NVIDIA GPU payloads are present */
  hasNvidiaPayload: boolean;
  /** NVIDIA verification results (if verifyNvidia was true) */
  nvidiaVerification?: NvidiaVerificationInfo;
  /** Error if attestation fetch failed */
  error?: string;
}

/**
 * Complete chat verification result
 */
export interface ChatVerificationResult {
  /** Overall verification status */
  verified: boolean;
  /** Chat completion ID from response */
  chatId: string;
  /** SHA-256 of request body */
  requestHash: string;
  /** SHA-256 of response text */
  responseHash: string;
  /** Raw signature response from NEAR AI */
  signature: SignatureResponse | null;
  /** Hash comparison details */
  hashValidation: HashValidation | null;
  /** Signature verification details */
  signatureValidation: SignatureValidation | null;
  /** Attestation information */
  attestation: AttestationInfo | null;
  /** Informational warnings (e.g., attestation missing) */
  warnings?: string[];
  /** Error message if verification failed */
  error?: string;
}

/**
 * Verification status for UI display
 */
export type VerificationStatus = "pending" | "verified" | "failed" | "unknown";

/**
 * Options for verifyChatMessage
 */
export interface VerifyOptions {
  /** Skip attestation fetch (not recommended - weakens security) */
  skipAttestation?: boolean;
  /** Verify NVIDIA GPU attestation payloads (recommended for GPU TEEs) */
  verifyNvidia?: boolean;
  /** Override base URL for NEAR AI API */
  baseUrl?: string;
  /** Override API key */
  apiKey?: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

// ============================================================================
// Verification Metadata + Result Types
// ============================================================================

/** Metadata for signature payloads exposed via verification results. */
export interface SignaturePayload {
  text?: string | null;
  signature?: string | null;
  signing_address?: string | null;
  signing_algo?: string | null;
}

export interface VerificationMetadata {
  source: "near-ai-cloud";
  status: VerificationStatus;
  messageId?: string;
  requestHash?: string;
  responseHash?: string;
  chatId?: string;
  error?: string;
}

export interface VerificationResult {
  verified: boolean;
  reasons: string[];
  status?: VerificationStatus;
  warnings?: string[];
  signature?: SignaturePayload | null;
  requestHash?: string | null;
  responseHash?: string | null;
  chatId?: string | null;
}
