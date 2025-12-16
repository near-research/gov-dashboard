export type {
  ChatCompletionResponse,
  NearAIErrorResponse,
  NearAIResponse,
} from "./schemas";

export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatMessageRole | string;
  content?: string | null;
  tool_calls?: unknown[];
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

export interface ChatCompletionOptions {
  timeout?: number;
  requestId?: string;
  baseUrl?: string;
  apiKey?: string;
  verificationId?: string;
  verificationNonce?: string;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  serializedBody?: string;
}
