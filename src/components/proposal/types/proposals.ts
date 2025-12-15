import type { ProposalFrontmatter } from "@/utils/metadata";
import type {
  DiscoursePost,
  DiscourseRevision,
  DiscourseUserRef,
} from "@/types/discourse";

export type ProposalReply = Pick<
  DiscoursePost,
  | "id"
  | "username"
  | "created_at"
  | "cooked"
  | "post_number"
  | "avatar_template"
  | "like_count"
  | "reply_to_post_number"
> & {
  reply_to_user?: DiscourseUserRef | null;
};

export interface ProposalDetailResponse {
  id: number;
  title: string;
  content: string;
  contentWithoutFrontmatter: string;
  metadata: ProposalFrontmatter;
  version: number;
  created_at: string;
  username: string;
  topic_id: number;
  topic_slug: string;
  reply_count: number;
  views: number;
  last_posted_at: string;
  like_count?: number;
  near_wallet?: string | null;
  category_id?: number;
  replies?: ProposalReply[];
}

export type ProposalRevision = DiscourseRevision;

/**
 * Lightweight proposal list format for chat message rendering
 * Used when agent returns structured proposal lists from Discourse tools
 */
export interface ProposalDisplayData {
  type: "proposal_list";
  description?: string;
  topics: Array<{
    id: number;
    title: string;
    slug: string;
    excerpt?: string;
    author: string;
    posts_count?: number;
    reply_count?: number;
    views?: number;
    like_count?: number;
    created_at: string;
    last_posted_at?: string;
    url: string;
  }>;
}

export const PROPOSAL_DISPLAY_TOOLS = [
  "get_latest_topics",
  "search_discourse",
] as const;

export type ProposalDisplayTool = typeof PROPOSAL_DISPLAY_TOOLS[number];

export function isProposalDisplayTool(toolName: string): toolName is ProposalDisplayTool {
  return PROPOSAL_DISPLAY_TOOLS.some((tool) => tool === toolName);
}
