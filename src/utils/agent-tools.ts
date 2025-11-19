import type {
  MessageRole,
  ProposalAgentState,
  ToolChoice,
} from "@/types/agui-events";
import {
  PROPOSAL_TOOLS,
  buildProposalSystemPrompt,
  inferProposalToolChoice,
  normalizeProposalAgentState,
} from "./proposal-agent";
import { DISCOURSE_TOOLS, buildDiscourseSystemPrompt } from "./discourse-agent";

export const AGENT_MODEL = "openai/gpt-oss-120b";

export const AGENT_TOOLS = [...PROPOSAL_TOOLS, ...DISCOURSE_TOOLS] as const;

export { PROPOSAL_TOOLS, DISCOURSE_TOOLS, normalizeProposalAgentState };

export function buildProposalAgentSystemPrompt(
  currentState: ProposalAgentState
): string {
  const proposalPrompt = buildProposalSystemPrompt(currentState);
  const discoursePrompt = buildDiscourseSystemPrompt();

  return `${proposalPrompt}

${discoursePrompt}`;
}

export const inferProposalAgentToolChoice = inferProposalToolChoice;

export interface BuildProposalAgentRequestParams {
  messages: Array<{ role: MessageRole; content: string }>;
  state?: Partial<ProposalAgentState>;
  model?: string;
}

export const buildProposalAgentRequest = ({
  messages,
  state,
  model = AGENT_MODEL,
}: BuildProposalAgentRequestParams) => {
  const normalizedState = normalizeProposalAgentState(state);
  const systemPrompt = buildProposalAgentSystemPrompt(normalizedState);
  const conversationMessages = [
    { role: "system" as MessageRole, content: systemPrompt },
    ...messages,
  ];

  const lastUserMessage =
    [...messages]
      .reverse()
      .find((msg) => msg.role === "user" && typeof msg.content === "string")
      ?.content || "";

  const toolChoice = inferProposalAgentToolChoice(lastUserMessage);

  return {
    normalizedState,
    toolChoice,
    requestBody: {
      model,
      messages: conversationMessages,
      tools: AGENT_TOOLS,
      tool_choice: toolChoice,
      stream: true,
    },
  };
};
