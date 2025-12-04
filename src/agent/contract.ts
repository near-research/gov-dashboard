export const AGENT_MODEL = "openai/gpt-oss-120b";

export type AgentChatMessage = { role: "user" | "assistant" | "system"; content: string };
