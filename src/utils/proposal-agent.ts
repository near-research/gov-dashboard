import type {
  MessageRole,
  ProposalAgentState,
  ToolChoice,
} from "@/types/agui-events";

export const PROPOSAL_AGENT_MODEL = "openai/gpt-oss-120b";

export const PROPOSAL_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "write_proposal",
      description: [
        "Write or edit a NEAR governance proposal.",
        "Use markdown formatting. Include sections: Objectives, Budget, Timeline, KPIs.",
        "Write the FULL proposal, even when changing only a few words.",
        "Make edits minimal and targeted to address specific screening criteria.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The proposal title",
          },
          content: {
            type: "string",
            description: "The full proposal content in markdown",
          },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screen_proposal",
      description:
        "Screen a proposal against NEAR governance criteria. Returns evaluation with pass/fail for quality criteria and attention scores.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The proposal title",
          },
          content: {
            type: "string",
            description: "The proposal content",
          },
        },
        required: ["title", "content"],
      },
    },
  },
] as const;

export const normalizeProposalAgentState = (
  state: Partial<ProposalAgentState> | undefined
): ProposalAgentState => ({
  title: state?.title ?? "",
  content: state?.content ?? "",
  evaluation: state?.evaluation ?? null,
});

export function buildProposalAgentSystemPrompt(
  currentState: ProposalAgentState
) {
  return `You are a NEAR governance proposal assistant. You help users write high-quality proposals that meet NEAR's criteria.

**Current Proposal State:**
Title: ${currentState.title || "(empty)"}
Content: ${currentState.content || "(empty)"}
${
  currentState.evaluation
    ? `Quality Score: ${(currentState.evaluation.qualityScore * 100).toFixed(
        0
      )}%
Attention Score: ${(currentState.evaluation.attentionScore * 100).toFixed(0)}%`
    : ""
}

**CRITICAL INSTRUCTIONS:**
- When the user asks you to write, generate, create, or add ANY content to the proposal, you MUST use the write_proposal tool
- When asked to "generate title", "add title", "write content" → use write_proposal tool immediately
- DO NOT just chat about what you would write - actually write it using the tool
- If title is empty and user asks for content, generate a title too
- If content is empty, generate full proposal content

**NEAR Proposal Criteria:**

**Quality Criteria (must all pass):**
1. **Complete**: Objectives, budget breakdown, timeline, measurable KPIs
2. **Legible**: Clear, well-structured, error-free, professionally formatted
3. **Consistent**: No contradictions in budget, timeline, or scope
4. **Compliant**: Follows NEAR governance rules and community standards
5. **Justified**: Strong rationale for funding amount and approach
6. **Measurable**: Clear success metrics and evaluation criteria

**Attention Scores (informational):**
- **Relevant**: How aligned is this with NEAR ecosystem priorities? (high/medium/low)
- **Material**: What's the potential impact and significance? (high/medium/low)

**Quality Score**: Percentage of quality criteria passed (need 100% to pass)
**Attention Score**: Combined relevance and materiality score (0.0 to 1.0)

**Your Tasks:**
- To screen: use screen_proposal tool
- To write/generate/create/add content: use write_proposal tool IMMEDIATELY
- Base edits on screening results - fix specific failing criteria
- Keep changes minimal and targeted
- After calling write_proposal, just briefly explain what you did (1-2 sentences)

${
  currentState.evaluation
    ? `
**Last Screening Results:**
Overall Pass: ${currentState.evaluation.overallPass ? "YES" : "NO"}
Quality Score: ${(currentState.evaluation.qualityScore * 100).toFixed(0)}% (${
        currentState.evaluation.qualityScore === 1.0
          ? "Perfect!"
          : "Needs improvement"
      })
Attention Score: ${(currentState.evaluation.attentionScore * 100).toFixed(
        0
      )}% (Relevant: ${
        currentState.evaluation.relevant?.score || "unknown"
      }, Material: ${currentState.evaluation.material?.score || "unknown"})

Failed Quality Criteria: ${
        Object.entries(currentState.evaluation)
          .filter(
            ([key, val]: [string, any]) =>
              [
                "complete",
                "legible",
                "consistent",
                "compliant",
                "justified",
                "measurable",
              ].includes(key) &&
              typeof val === "object" &&
              val.pass === false
          )
          .map(([key, val]: [string, any]) => `${key} (${val.reason})`)
          .join("; ") || "None - all quality criteria passed!"
      }
`
    : ""
}`;
}

const containsAny = (text: string, keywords: string[]) =>
  keywords.some((kw) => text.includes(kw));

export const inferProposalAgentToolChoice = (
  lastUserMessage: string
): ToolChoice => {
  const normalized = lastUserMessage.toLowerCase();
  const isWriteIntent = containsAny(normalized, [
    "write",
    "generate",
    "create",
    "add",
    "improve",
    "edit",
    "draft",
  ]);
  const isScreenIntent = containsAny(normalized, [
    "screen",
    "evaluate",
    "check",
    "review",
    "analysis",
    "analyze",
  ]);

  if (isWriteIntent && !isScreenIntent) {
    return {
      type: "function",
      function: { name: "write_proposal" },
    };
  }

  if (isScreenIntent && !isWriteIntent) {
    return {
      type: "function",
      function: { name: "screen_proposal" },
    };
  }

  return "auto";
};

export interface BuildProposalAgentRequestParams {
  messages: Array<{ role: MessageRole; content: string }>;
  state?: Partial<ProposalAgentState>;
  model?: string;
}

export const buildProposalAgentRequest = ({
  messages,
  state,
  model = PROPOSAL_AGENT_MODEL,
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
      tools: PROPOSAL_AGENT_TOOLS,
      tool_choice: toolChoice,
      stream: true,
    },
  };
};
