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
