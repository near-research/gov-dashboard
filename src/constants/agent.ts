/**
 * Agent system constants
 */

export const AGENT_MODEL = "openai/gpt-oss-120b";

export type AgentChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

// Maximum iterations before forcing stop
export const MAX_TOOL_ITERATIONS = 5;

// Timeout for AI completion requests (ms)
export const AI_COMPLETION_TIMEOUT_MS = 30_000;

// SSE keep-alive interval (ms)
export const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
