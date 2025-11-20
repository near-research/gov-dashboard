import type { VerificationMetadata } from "@/types/agui-events";
import type { PartialExpectations } from "@/utils/attestation-expectations";
import type { VerificationProofResponse } from "@/types/verification";

export interface SummaryProof extends PartialExpectations {
  requestHash?: string;
  responseHash?: string;
  nonce?: string;
}

export interface DiscussionEngagementSummary {
  totalLikes: number;
  totalReplies: number;
  participantCount?: number;
  avgLikesPerReply: number;
  highlyEngagedReplies: number;
  maxLikes: number;
}

export interface TextSummaryResponse {
  success: true;
  summary: string;
  cached?: boolean;
  cacheAge?: number;
  model?: string | null;
  verification?: VerificationMetadata | null;
  verificationId?: string | null;
  proof?: SummaryProof | null;
  remoteProof?: VerificationProofResponse | null;
}

export interface ProposalSummaryResponse extends TextSummaryResponse {
  proposalId: string;
  title: string;
  author: string;
  createdAt: string;
  truncated: boolean;
  viewCount?: number;
  replyCount?: number;
  likeCount?: number;
  generatedAt: number;
}

export interface DiscussionSummaryResponse extends TextSummaryResponse {
  topicId: string;
  title: string;
  replyCount: number;
  truncated: boolean;
  engagement?: DiscussionEngagementSummary;
  generatedAt: number;
  cached: boolean;
}

export interface ReplySummaryResponse extends TextSummaryResponse {
  replyId: string;
  author: string;
  postNumber: number;
  createdAt: string;
  likeCount: number;
  replyTo: { username?: string; postNumber?: number } | null;
  parentPostIncluded: boolean;
  truncated: boolean;
  generatedAt: number;
  cached: boolean;
}

export interface ProposalRevisionSummaryResponse extends TextSummaryResponse {
  topicId: string;
  postId: number;
  author: string;
  currentVersion: number;
  totalRevisions: number;
  revisions: Array<{
    version: number;
    editedBy: string;
    editedAt: string;
    editReason: string | null;
    hasTitleChange: boolean;
    hasBodyChange: boolean;
  }>;
  truncated: boolean;
  generatedAt: number;
  cached: boolean;
}

export interface PostRevisionSummaryResponse extends TextSummaryResponse {
  postId: string;
  author: string;
  currentVersion: number;
  totalRevisions: number;
  revisions: ProposalRevisionSummaryResponse["revisions"];
  truncated: boolean;
  generatedAt: number;
  cached: boolean;
}
