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
      tool_calls?: unknown[];
    };
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: unknown[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  [key: string]: unknown;
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
}
