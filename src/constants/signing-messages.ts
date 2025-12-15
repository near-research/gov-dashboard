/**
 * Centralized signing message templates for `near-sign-verify`.
 */
export const SIGNING_MESSAGES = {
  DISCOURSE_LINK: "Link my NEAR account to Discourse",
  DISCOURSE_PUBLISH: "Publish proposal draft to Discourse",
  screenProposal: (topicId: string) => `Screen proposal ${topicId}`,
  replyToProposal: (topicId: number) => `Reply to proposal ${topicId}`,
  fetchVerificationProof: (verificationId?: string) =>
    verificationId
      ? `Fetch verification proof ${verificationId}`
      : "Fetch verification proof",
} as const;
