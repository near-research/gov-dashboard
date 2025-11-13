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

export interface DiscussionSummaryResponse {
  success: true;
  summary: string;
  topicId: string;
  title: string;
  replyCount: number;
  truncated: boolean;
  engagement?: DiscussionEngagementSummary;
  generatedAt: number;
  cached: boolean;
  cacheAge?: number;
}

export interface ReplySummaryResponse {
  success: true;
  summary: string;
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
  cacheAge?: number;
}

export interface ProposalRevisionSummaryResponse {
  success: true;
  summary: string;
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
  cacheAge?: number;
}

export interface PostRevisionSummaryResponse {
  success: true;
  summary: string;
  postId: string;
  author: string;
  currentVersion: number;
  totalRevisions: number;
  revisions: ProposalRevisionSummaryResponse["revisions"];
  truncated: boolean;
  generatedAt: number;
  cached: boolean;
  cacheAge?: number;
}
