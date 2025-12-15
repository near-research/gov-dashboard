// Client
export {
  NearAIClient,
  getNearAIClient,
  createNearAIClient,
  resetNearAIClient,
} from "./client";

// Errors
export {
  NearAIError,
  NearAITimeoutError,
  NearAIConfigurationError,
} from "./errors";

// Verification
export * from "./verification";

// Types
export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionOptions,
  ChatMessage,
  ChatMessageRole,
  ToolChoice,
} from "./types";

// Streaming
export { streamChatCompletion, type StreamChatResult } from "./stream";
