/**
 * Generates the AI prompt for summarizing NEAR governance proposal discussions
 * @param topicData - Topic information including title
 * @param replies - Array of discussion replies
 * @param totalLikes - Total likes across all replies
 * @param avgLikes - Average likes per reply
 * @param maxLikes - Highest number of likes on a single reply
 * @param highlyEngagedReplies - Count of replies with 6+ likes
 * @param truncatedDiscussion - Formatted discussion content
 * @returns Complete prompt string for AI discussion summarization
 */
export function buildDiscussionSummaryPrompt(
  topicData: { title: string },
  replies: any[],
  totalLikes: number,
  avgLikes: number,
  maxLikes: number,
  highlyEngagedReplies: number,
  truncatedDiscussion: string
): string {
  return `You are summarizing community discussion on a NEAR governance proposal. Analyze the replies and provide insights.

**Topic:** ${topicData.title}
**Total Replies:** ${replies.length}

**Engagement Statistics:**
- Total Likes: ${totalLikes}
- Average Likes per Reply: ${avgLikes}
- Highest Liked Reply: ${maxLikes} likes
- Highly Engaged Replies (6+ likes): ${highlyEngagedReplies}

IMPORTANT CONTEXT:
1. Replies are in CHRONOLOGICAL ORDER to show how the conversation evolved
2. Each reply shows: [X likes] for engagement level
3. CRITICAL: Each reply may show [Replying to Post #X by @username] - this indicates the reply is responding to a SPECIFIC earlier post, not necessarily the previous one chronologically or the original proposal
4. Pay attention to reply chains - when multiple people reply to the same post, it indicates an important sub-discussion

Use like counts to identify:
- Community-validated points (higher likes = stronger agreement)
- Influential voices (consistently high engagement)
- Controversial points (discussion without many likes)
- Emerging consensus (likes increasing over time)

Use reply threading to understand:
- Which specific points sparked debate
- How sub-discussions evolved
- Which concerns were addressed (and by whom)
- Conversation branches and their resolution

Consider timing, validation (likes), AND reply structure when analyzing the discussion.

**Discussion:**
${truncatedDiscussion}

Provide a comprehensive discussion summary covering:

**Sentiment**
[<80 chars; supportive/opposed/mixed/neutral]

**Themes**
[<500 chars; main agreements + main concerns based on like patterns and repeated points]

**Controversy**
[<400 chars; core disagreements or unresolved blockers]

**Hot Takes**
[<200 chars; one or two replies that reframed the thread, shifted the conversation, or triggered engagement; skip if no reply materially changed the discussion]

**Consensus**
[<200 chars; gauge how consensus is progressing through discussion, where views are converging vs stuck]

**Loose Ends**
[<200 chars; critical missing info, unanswered questions, unaddressed suggestions]

Focus on substance over noise. Weight your analysis based on timing (when said), validation (likes received), AND conversation structure (what sparked replies).`;
}
