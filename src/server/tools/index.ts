/**
 * Agent Tools - Definitions & Request Builder
 */

import type { MessageRole, AgentState, ToolChoice } from "@/types/agui-events";

import {
  PROPOSAL_TOOLS,
  buildProposalSystemPrompt,
  normalizeAgentState,
  inferProposalToolChoice,
} from "./proposals";

import { DISCOURSE_TOOLS, buildDiscourseSystemPrompt } from "./discourse";

import { DOCS_TOOLS, buildDocsSystemPrompt } from "./docs";

// ============================================================================
// Combined Tools
// ============================================================================

export const AGENT_TOOLS = [
  ...PROPOSAL_TOOLS,
  ...DISCOURSE_TOOLS,
  ...DOCS_TOOLS,
];

// ============================================================================
// Model Configuration
// ============================================================================

export const AGENT_MODEL = "openai/gpt-oss-120b";

// ============================================================================
// Request Builder
// ============================================================================

export function buildAgentRequest({
  messages,
  state,
  model,
}: {
  messages: Array<{ role: MessageRole; content: string }>;
  state?: Partial<AgentState>;
  model: string;
}): {
  requestBody: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    tools: typeof AGENT_TOOLS;
    tool_choice: ToolChoice;
    stream: boolean;
  };
  toolChoice: ToolChoice;
} {
  const currentState = normalizeAgentState(state);

  // Build combined system prompt from all domains
  const systemPrompt = [
    buildProposalSystemPrompt(currentState),
    buildDiscourseSystemPrompt(),
    buildDocsSystemPrompt(),
  ].join("\n\n---\n\n");

  // Infer tool choice from last user message
  const lastUserMessage =
    messages.filter((m) => m.role === "user").pop()?.content || "";
  const toolChoice = inferProposalToolChoice(lastUserMessage);

  const requestBody = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    tools: AGENT_TOOLS,
    tool_choice: toolChoice,
    stream: true,
  };

  return { requestBody, toolChoice };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { normalizeAgentState, inferProposalToolChoice } from "./proposals";
