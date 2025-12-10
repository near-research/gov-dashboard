export {
  NearAIClient,
  getNearAIClient,
  createNearAIClient,
  resetNearAIClient,
} from "./client";

export {
  NearAIError,
  NearAITimeoutError,
  NearAIConfigurationError,
} from "./errors";

export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionOptions,
  ChatMessage,
  ChatMessageRole,
  ToolChoice,
} from "@/types/near-ai";

export type {
  VerificationSession,
  VerificationResult,
  NrasVerificationResult,
  SignatureVerificationResult,
  NonceCheck,
  SignaturePayload,
  NearAIVerificationOptions,
} from "@/types/verification";
