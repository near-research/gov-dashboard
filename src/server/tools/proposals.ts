/**
 * Proposal Tools - Writing & Screening
 */

import type { AgentState, ToolChoice } from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";
import { requestEvaluation } from "@/server/screening";
import type { VerificationMetadata, VerificationStatus } from "@/lib/near-ai";

// ============================================================================
// Tool Definitions
// ============================================================================

export const PROPOSAL_TOOLS = [
  {
    type: "function",
    function: {
      name: "write_proposal",
      description:
        "Writes or rewrites NEAR governance proposal content and returns the updated draft. Do NOT automatically screen or evaluate after writing — only return the result unless the user explicitly asks for follow-up.",
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
        "Evaluates the proposal against NEAR governance criteria and returns a structured screening report. Do NOT automatically fix issues — only return the evaluation unless the user explicitly asks for edits.",
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

// ============================================================================
// State Normalization
// ============================================================================

export const normalizeAgentState = (
  state: Partial<AgentState> | undefined
): AgentState => ({
  title: state?.title ?? "",
  content: state?.content ?? "",
  evaluation: state?.evaluation ?? null,
});

// ============================================================================
// Tool Choice Inference
// ============================================================================

const containsAny = (text: string, keywords: string[]) =>
  keywords.some((kw) => text.includes(kw));

export const inferProposalToolChoice = (
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

// ============================================================================
// System Prompt
// ============================================================================

export function buildProposalSystemPrompt(currentState: AgentState): string {
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

**Task Completion Rules**
1. COMPLETE THE REQUEST, THEN STOP: Use the tools needed to fulfill the user's request, then respond. Do not add extra steps the user didn't ask for. One or two tool calls is typical; more is fine if explicitly requested.
2. DO NOT AUTO-CHAIN (but chaining when asked is fine):
   - After write_proposal → Return the written content to the user. Do NOT auto-screen unless the user asked.
   - After screen_proposal → Return the evaluation to the user. Do NOT auto-fix unless the user asked.
   - "Screen and fix issues" → screen then write is correct (2 tools).
   - "Improve this" → write only (1 tool).

**WHEN TO STOP:**
- The user's request has been fulfilled.
- A tool returned success.
- The user asked a simple question or requested a single edit.

**WHEN TO CONTINUE:**
- The user explicitly requested multiple steps.
- A tool returned an error that needs handling.
- The user's message contains multiple distinct tasks.

AFTER COMPLETING A TOOL CALL: Respond with a brief summary (1-2 sentences) of what was done. Do not call additional tools unless explicitly asked.

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
            ([key, val]: [string, unknown]) =>
              [
                "complete",
                "legible",
                "consistent",
                "compliant",
                "justified",
                "measurable",
              ].includes(key) &&
              typeof val === "object" &&
              val !== null &&
              (val as { pass?: boolean }).pass === false
          )
          .map(
            ([key, val]) => `${key} (${(val as { reason?: string }).reason})`
          )
          .join("; ") || "None - all quality criteria passed!"
      }
`
    : ""
}`;
}

// ============================================================================
// Tool Handlers
// ============================================================================

export interface WriteProposalResult {
  title: string;
  content: string;
  status: "pending_confirmation";
}

export async function handleWriteProposal(args: {
  title: string;
  content: string;
}): Promise<{ result: WriteProposalResult }> {
  return {
    result: {
      title: args.title,
      content: args.content,
      status: "pending_confirmation",
    },
  };
}

export async function handleScreenProposal(args: {
  title: string;
  content: string;
}): Promise<{ result: Evaluation; verification?: VerificationMetadata }> {
  const screeningResult = await requestEvaluation(args.title, args.content);

  const verificationResult = screeningResult.verificationResult;
  let verification: VerificationMetadata | undefined;
  if (verificationResult || screeningResult.chatId) {
    const status: VerificationStatus = verificationResult
      ? verificationResult.verified
        ? "verified"
        : "failed"
      : "pending";

    verification = {
      source: "near-ai-cloud",
      status,
      messageId:
        screeningResult.chatId ||
        verificationResult?.chatId ||
        undefined,
      requestHash: verificationResult?.requestHash ?? undefined,
      responseHash: verificationResult?.responseHash ?? undefined,
    };
  }

  return {
    result: screeningResult.evaluation,
    verification,
  };
}
