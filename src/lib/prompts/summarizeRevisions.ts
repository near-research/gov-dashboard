import type { ProposalRevision } from "@/types/proposals";

/**
 * Generates the AI prompt for analyzing NEAR governance post revision history
 * @param id - Post ID
 * @param postData - Post data including author username
 * @param revisions - Array of revision data
 * @param version - Current version number
 * @param truncatedTimeline - Formatted revision timeline
 * @returns Complete prompt string for AI revision analysis
 */
export function buildRevisionAnalysisPrompt(
  id: string,
  postData: { username: string },
  revisions: ProposalRevision[],
  version: number,
  truncatedTimeline: string
): string {
  return `You are analyzing revision history for a NEAR governance post. Provide insights into what changed and why.

**Post ID:** ${id}
**Original Author:** @${postData.username}
**Total Revisions:** ${revisions.length}
**Current Version:** ${version}

**Revision Timeline:**
${truncatedTimeline}

Provide a comprehensive revision analysis covering:

[Flag whether substantive changes were made or not:
**⚠️ Substantive changes: material edits affecting scope or decision factors.**
**✅ Minor edits only: clarifications, corrections, formatting.**]

**Key Changes**
[<600 chars; 2–5 key edits - state exactly what changed + why; note if substantive or minor; note timing if relevant (e.g. delayed substantial changes); format as bullet points]
[For each change, nest a bullet point, starting with "**Why it matters:**"; direct effect on scope, risk, feasibility, incentives, or governance. Say plainly if the decision calculus changes.]

**Recommendation**
[1–2 sentences. Should stakeholders re-read? Which revision is relevant? Skip if no substantive changes were identified.]

Be specific about what changed. If revisions are minimal (typos, formatting), state that clearly. If substantive, highlight what decision-makers need to reconsider.`;
}
