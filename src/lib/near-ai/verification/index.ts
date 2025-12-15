// Core helpers
export { sha256sum, extractChatId, parseSignatureText } from "./hash";
export { fetchSignature, compareHashes, verifySignature } from "./signature";
export { fetchAttestation, isAddressInTeeList } from "./attestation";
export { verifyChatMessage } from "./verify";

// NVIDIA attestation helpers
export {
  verifyNvidiaPayload,
  verifyNvidiaPayloads,
} from "./nvidia";

export type {
  NvidiaAttestationResult,
  NvidiaVerifyOptions,
} from "./nvidia";

// Types
export type {
  SignatureResponse,
  HashValidation,
  SignatureValidation,
  ChatVerificationResult,
  VerificationStatus,
  AttestationInfo,
  VerifyOptions,
  SignaturePayload,
  VerificationMetadata,
  VerificationResult,
} from "./types";

export type {
  ModelAttestation,
  AttestationReport,
  AttestationResult,
} from "./attestation";
