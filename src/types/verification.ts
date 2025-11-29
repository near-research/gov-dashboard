export interface NonceCheck {
  expected?: string | null;
  attested?: string | null;
  nras?: string | null;
  valid: boolean;
}

/**
 * NRAS (NVIDIA Remote Attestation Service) verification result
 */
export interface NrasResult {
  /** JWT token from NRAS */
  token?: string | null;
  jwt?: string | null;
  /** Decoded JWT claims */
  claims?: {
    /** Issued at timestamp */
    iat?: number;
    /** Expiration timestamp */
    exp?: number;
    /** Not before timestamp */
    nbf?: number;
    /** Issuer (should be https://nras.attestation.nvidia.com) */
    iss?: string;
    /** Overall attestation result */
    "x-nvidia-overall-att-result"?: boolean;
    /** Nonce */
    eat_nonce?: string;
    "x-nvidia-eat-nonce"?: string;
    nonce?: string;
    /** Hardware model */
    hwmodel?: string;
    "x-nvidia-gpu-hwmodel"?: string;
    /** GPU driver version */
    "x-nvidia-gpu-driver-version"?: string;
    /** GPU VBIOS version */
    "x-nvidia-gpu-vbios-version"?: string;
    /** Secure boot status */
    secboot?: boolean | string;
    /** Debug status */
    dbgstat?: string;
    "x-nvidia-dbgstat"?: string;
    /** OEM ID */
    oemid?: string;
    overall_result?: boolean;
    overall_pass?: boolean;
  } | null;

  /** Verification status from backend */
  verified?: boolean;

  /** GPU-specific tokens */
  gpus?: Record<string, string> | null;

  /** Verification failure reasons */
  reasons?: string[];

  /** Raw NRAS response */
  raw?: unknown;
}
// Backwards compatibility alias
export type NrasVerificationResult = NrasResult;

export interface IntelVerificationResult {
  verified: boolean;
  raw?: any;
  error?: string;
  details?: string;
  reasons?: string[];
}

export interface VerificationProofResponse {
  attestation?: any;
  signature?: any;
  nras?: NrasResult | null;
  nrasRaw?: any;
  nonceCheck?: NonceCheck | null;
  intel?: IntelVerificationResult | null;
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
    gpu?: NrasResult | null;
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
}

export interface NrasVerificationRequest {
  nvidia_payload: any;
  nonce?: string | null;
  expectedArch?: string | null;
  expectedDeviceCertHash?: string | null;
  expectedRimHash?: string | null;
  expectedUeid?: string | null;
  expectedMeasurements?: string[] | null;
}

export type { VerificationMetadata, VerificationStatus } from "@/types/agui-events";
