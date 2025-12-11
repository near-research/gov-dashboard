import type { NormalizedVerificationResult } from "@/utils/verification/shared";

// ============================================================================
// Session Types
// ============================================================================
/** Tracks the lifecycle state of a NEAR verification session. */
export interface VerificationSession {
  nonce: string;
  createdAt: number;
  expiresAt: number;
  requestHash?: string | null;
  responseHash?: string | null;
}

// ============================================================================
// Client Verification Options
// ============================================================================
/** Options for NEAR AI verification headers. */
export interface NearAIVerificationOptions {
  verificationId?: string;
  verificationNonce?: string;
  requestHash?: string;
  responseHash?: string;
  signingAlgo?: "ecdsa" | "ed25519";
  extraHeaders?: Record<string, string>;
}

// ============================================================================
// Verification Result Types
// ============================================================================
/** NRAS verification status returned to clients. */
export interface NrasVerificationResult {
  verified: boolean;
  jwt?: string | null;
  claims?: Record<string, unknown> | null;
  reasons?: string[];
  token?: string | null;
  gpus?: Record<string, string> | null;
  raw?: unknown;
}
/** Results of signature verification checks. */
export interface SignatureVerificationResult {
  verified: boolean;
  recoveredAddress?: string | null;
  attestedAddresses?: string[];
  reason?: string;
}

/** Metadata for signature payloads exposed via verification results. */
export interface SignaturePayload {
  text?: string | null;
  signature?: string | null;
  signing_address?: string | null;
  signing_algo?: string | null;
}

/** Aggregated verification result shared across UI and API consumers. */
export interface VerificationResult {
  verified: boolean;
  reasons: string[];
  status?: "verified" | "pending" | "failed";
  warnings?: string[];
  attestedAddresses?: string[];
  attestation?: unknown;
  signature?: SignaturePayload | null;
  nras?: NrasVerificationResult | null;
  signatureVerification?: SignatureVerificationResult;
  nonceCheck?: NonceCheck;
  intel?: IntelVerificationResult | null;
  attestationNodes?: AttestationNodeSummary[] | null;
  configMissing?: {
    nearApiKey?: boolean;
    intel?: boolean;
    intelApiKey?: boolean;
    hardwareExpectations?: boolean;
  };
  results?: {
    verified: boolean;
    reasons: string[];
    info?: string[];
    gpu?: NrasVerificationResult | null;
    cpu?: IntelVerificationResult | null;
    nonce?: NonceCheck | null;
    signature?: {
      verified: boolean;
      recoveredAddress?: string | null;
      attestedAddress?: string | null;
      reason?: string;
    };
  };
  requestHash?: string | null;
  responseHash?: string | null;
  sessionRequestHash?: string | null;
  sessionResponseHash?: string | null;
  chatId?: string | null;
}

/** Named stages within the NEAR verification workflow. */
export type VerificationStage = "initial_reasoning" | "final_synthesis";

/** Canonical payload emitted when a verification stage completes. */
export interface VerificationPayload {
  messageId: string;
  verificationId: string;
  requestHash: string;
  responseHash: string;
  nonce: string | null;
  stage: VerificationStage;
}

// ============================================================================
// Hardware Expectation Types
// ============================================================================
/** Expectations derived from attestation metadata (nonce, hardware profile, etc.). */
export interface AttestationExpectations {
  nonce: string;
  arch: string; // 'HOPPER' | 'BLACKWELL' | 'intel-tdx'
  deviceCertHash: string;
  rimHash?: string | null;
  ueid?: string | null;
  measurements: string[];
}

/** Partial attestation expectations during incremental extraction/validation. */
export type PartialExpectations = Partial<AttestationExpectations>;

// ============================================================================
// NRAS (NVIDIA) Types
// ============================================================================
/** Payload sent to NRAS to validate a node. */
export interface NrasVerificationRequest {
  nvidia_payload: any;
  nonce?: string | null;
  expectedArch?: string | null;
  expectedDeviceCertHash?: string | null;
  expectedRimHash?: string | null;
  expectedUeid?: string | null;
  expectedMeasurements?: string[] | null;
}

// ============================================================================
// Intel TDX Types
// ============================================================================
/** Intel attestation verification result wrapper. */
export interface IntelVerificationResult {
  verified: boolean;
  raw?: any;
  error?: string;
  details?: string;
  reasons?: string[];
}

export interface IntelTdxVerificationResult {
  verified: boolean;
  reportDataValid: boolean;
  signingAddressBound: boolean;
  nonceBound: boolean;
  composeHashValid?: boolean;
  error?: string;
  reasons: string[];
}

// ============================================================================
// Verification State Types
// ============================================================================
/** Keys representing the discrete verification checks displayed in the UI. */
export type VerificationStepKey =
  | "hash"
  | "signature"
  | "address"
  | "attestation"
  | "nonce"
  | "gpu"
  | "cpu";

/** Status and messaging for a single verification step. */
export interface VerificationStep {
  status: "pending" | "success" | "error";
  message?: string;
  details?: string;
}

/** Aggregated verification state used by UI components. */
export interface VerificationState {
  overall: "unverified" | "pending" | "verified" | "failed";
  steps: Record<VerificationStepKey, VerificationStep>;
  recoveredAddress?: string | null;
  attestedAddress?: string | null;
  reasons?: string[];
}

/** Nonce verification outcome combining attestation + optional NRAS signals. */
export interface NonceCheck {
  valid: boolean;
  expected?: string | null;
  attested?: string | null;
  /** Nonce extracted from NRAS JWT claims (only present after NRAS verification). */
  nras?: string | null;
}

/** Arguments accepted by `deriveVerificationState`. */
export interface DeriveArgs {
  proof?: VerificationProofResponse | null;
  requestHash?: string | null;
  responseHash?: string | null;
  signatureText?: string | null;
  signature?: string | null;
  signatureAddress?: string | null;
  signatureAlgo?: string | null;
  attestedAddress?: string | null;
  attestationResult?: string | null;
  nrasVerified?: boolean;
  nrasReasons?: string[];
  intelVerified?: boolean;
  nonceCheck?: NonceCheck | null;
  intelRequired?: boolean;
  intelConfigured?: boolean;
  normalizedVerification?: NormalizedVerificationResult | null;
  trustedAddresses?: string[];
}

// ============================================================================
// Proof Response Types
// ============================================================================
/** Error returned while fetching a signature. */
export interface SignatureFetchError {
  status?: number;
  statusText?: string | null;
  message: string;
  url?: string;
}

/** Summary for attestation nodes discovered in a proof. */
export interface AttestationNodeSummary {
  signingAddress: string | null;
  nvidiaPayload: unknown;
  intelQuote: unknown;
  composeManifest: string | null;
  composeHash: string | null;
  nras?: NrasVerificationResult | null;
  intel?: IntelVerificationResult | null;
}

/** Response returned during model attestation discovery flows. */
export interface ModelAttestationResponse {
  model?: string;
  model_id?: string;
  issued_at?: number | string;
  timestamp?: number | string;
  nvidia_payload?: unknown;
  intel_quote?: unknown;
  gateway_attestation?: ModelAttestationResponse | null;
  model_attestations?: Array<ModelAttestationResponse | null> | null;
  attestation?: ModelAttestationResponse | null;
  all_attestations?: Array<ModelAttestationResponse | null> | null;
  evidence_list?: unknown;
  info?: Record<string, unknown> | null;
  event_log?: unknown;
  eventLog?: unknown;
  request_nonce?: string | null;
  requestNonce?: string | null;
  signing_address?: string | null;
  signingAddress?: string | null;
  [key: string]: unknown;
}

/** Attestation payload returned by NEAR verification proofs. */
export interface VerificationAttestationPayload extends ModelAttestationResponse {
  gateway_attestation?: VerificationAttestationPayload | null;
  model_attestations?: Array<VerificationAttestationPayload | null>;
  all_attestations?: Array<VerificationAttestationPayload | null>;
  signing_address?: string | null;
  signingAddress?: string | null;
  key?: string | null;
  signing_algo?: string | null;
  signing_algorithm?: string | null;
  algorithm?: string | null;
  report_data?: string | null;
  reportData?: string | null;
  request_nonce?: string | null;
  requestNonce?: string | null;
  [key: string]: unknown;
}

/** Payload returned by the verification proof endpoint. */
export interface VerificationProofResponse {
  attestation?: VerificationAttestationPayload;
  signature?: any;
  signatureVerification?: SignatureVerificationResult | null;
  signatureError?: SignatureFetchError | null;
  nras?: NrasVerificationResult | null;
  nrasRaw?: any;
  nonceCheck?: NonceCheck | null;
  intel?: IntelVerificationResult | null;
  attestationNodes?: AttestationNodeSummary[] | null;
  configMissing?: {
    nearApiKey?: boolean;
    intel?: boolean;
    intelApiKey?: boolean;
    hardwareExpectations?: boolean;
  };
  verified?: boolean;
  reasons?: string[];
  info?: string[];
  results?: {
    verified: boolean;
    reasons: string[];
    info?: string[];
    gpu?: NrasVerificationResult | null;
    cpu?: IntelVerificationResult | null;
    nonce?: NonceCheck | null;
    signature?: {
      verified: boolean;
      recoveredAddress?: string | null;
      attestedAddress?: string | null;
      reason?: string;
    };
  };
  normalized?: NormalizedVerificationResult | null;
  requestHash?: string | null;
  responseHash?: string | null;
  sessionRequestHash?: string | null;
  sessionResponseHash?: string | null;
  nonce?: string | null;
}

export type RemoteProof = VerificationProofResponse;

// ============================================================================
// Metadata Types
// ============================================================================
/** High-level verification status reported through AGUI events. */
export type VerificationStatus = "pending" | "verified" | "failed";

/** Metadata attached to AGUI events for NEAR proofs. */
export interface VerificationMetadata {
  source: "near-ai-cloud";
  status: VerificationStatus;
  messageId?: string;
  nonce?: string;
  attestationReport?: string;
  attestationUrl?: string;
  proof?: unknown;
  signature?: string;
  measurement?: string;
  issuedAt?: string | number;
  error?: string;
}
