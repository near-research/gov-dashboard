/**
 * NEAR AI Cloud API Types
 */

export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatMessageRole | string;
  content?: string | null;
  tool_calls?: unknown;
  [key: string]: unknown;
}

export type ToolChoice =
  | "none"
  | "auto"
  | {
      type: "function";
      function: { name: string };
    };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: unknown;
  tool_choice?: ToolChoice;
}

export interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index: number;
    message?: {
      role: string;
      content: string;
      tool_calls?: unknown;
    };
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: unknown;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  [key: string]: unknown; // Allow additional properties for verification metadata
}

export interface ChatCompletionOptions {
  /**
   * Request timeout in milliseconds (default: 120000 = 2 minutes)
   */
  timeout?: number;
  /**
   * Optional unique request identifier (sent as X-Request-Id). When omitted, a
   * random UUID will be generated per client request.
   */
  requestId?: string;
  /**
   * Custom API base URL (default: https://cloud-api.near.ai)
   */
  baseUrl?: string;
  /**
   * Custom API key (default: from NEAR_AI_CLOUD_API_KEY env var)
   */
  apiKey?: string;
  /**
   * Verification ID for request verification
   */
  verificationId?: string;
  /**
   * Nonce for request verification
   */
  verificationNonce?: string;
  /**
   * Number of retry attempts for transient errors (default: 0)
   */
  retryAttempts?: number;
  /**
   * Base delay in milliseconds for exponential backoff (default: 100)
   */
  retryBaseDelayMs?: number;
  /**
   * Verification metadata for NEAR AI requests (creates standard headers)
   */
  verification?: NearAIVerificationOptions;
}

export interface NearAIVerificationOptions {
  verificationId?: string;
  verificationNonce?: string;
  requestHash?: string;
  responseHash?: string;
  signingAlgo?: "ecdsa" | "ed25519";
  extraHeaders?: Record<string, string>;
}
