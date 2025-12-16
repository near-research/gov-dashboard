import type { ApiErrorResponse } from "./base";

// ============================================
// Category Types (camelCase)
// ============================================

export interface DiscourseCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  topicCount: number;
  postCount: number;
  parentCategoryId: number | null;
  readRestricted: boolean;
}

export interface CategoriesSuccessResponse {
  categories: DiscourseCategory[];
}

export type CategoriesResponse = CategoriesSuccessResponse | ApiErrorResponse;

export interface CategoryDetailSuccessResponse {
  category: DiscourseCategory;
  subcategories: DiscourseCategory[];
}

export type CategoryDetailResponse = CategoryDetailSuccessResponse | ApiErrorResponse;

// ============================================
// Post Types (camelCase)
// ============================================

export interface DiscoursePost {
  id: number;
  topicId: number;
  postNumber: number;
  username: string;
  name: string | null;
  avatarTemplate: string;
  cooked: string;
  createdAt: string | null;
  updatedAt: string | null;
  replyCount: number;
  likeCount: number;
  quoteCount?: number;  // OPTIONAL - not all handlers return this
  replyToPostNumber: number | null;
  raw?: string;
  canEdit?: boolean;
}

export interface DiscourseTopicSummary {
  id: number;
  title: string;
  slug: string;
  postsCount?: number;
  categoryId?: number | null;
}

export interface PostsSuccessResponse {
  post: DiscoursePost;
  topic: DiscourseTopicSummary;
}

export type PostsResponse = PostsSuccessResponse | ApiErrorResponse;

// ============================================
// Replies Types
// ============================================

export interface RepliesSuccessResponse {
  posts: DiscoursePost[];
  postId: number;
  total: number;
}

export type RepliesResponse = RepliesSuccessResponse | ApiErrorResponse;

// ============================================
// Tag Types (matches actual handler output)
// ============================================

export interface DiscourseTag {
  id: number;  // number, not string
  name: string;
  topicCount: number;
  pmTopicCount: number;
  synonyms: string[];
  targetTag: string | null;
  description: string | null;
  // NOTE: no slug - handlers don't return it
}

export interface TagsSuccessResponse {
  tags: DiscourseTag[];
}

export type TagsResponse = TagsSuccessResponse | ApiErrorResponse;

// ============================================
// Topic Types (snake_case - Discourse API format)
// ============================================

export interface DiscourseTopicPost {
  id: number;
  post_number: number;
  username: string;
  cooked: string;
  created_at: string;
  like_count?: number | null;
  actions_summary?: Array<{ id: number; count?: number }>;
  reply_count?: number;
  reply_to_post_number?: number | null;
  avatar_template?: string | null;  // Allow null
  name?: string | null;
  raw?: string;
  updated_at?: string;
  reads?: number;
  readers_count?: number;
  score?: number;
  yours?: boolean;
  topic_id?: number;
  topic_slug?: string;
  display_username?: string | null;
  primary_group_name?: string | null;
  flair_name?: string | null;
  flair_url?: string | null;
  flair_bg_color?: string | null;
  flair_color?: string | null;
  flair_group_id?: number | null;
  version?: number;
  can_edit?: boolean;
  can_delete?: boolean;
  can_recover?: boolean;
  can_see_hidden_post?: boolean;
  can_wiki?: boolean;
  user_title?: string | null;
  bookmarked?: boolean;
  topic_bumped_at?: string | null;
}

export interface DiscourseTopic {
  id: number;
  title: string;
  slug: string;
  posts_count?: number;
  reply_count?: number;
  created_at?: string;
  last_posted_at?: string | null;
  category_id?: number | null;
  views?: number;
  like_count?: number;
  visible?: boolean;
  closed?: boolean;
  archived?: boolean;
  pinned?: boolean;
  fancy_title?: string;
  highest_post_number?: number;
  word_count?: number;
  chunk_size?: number;
  post_stream?: {
    posts: DiscourseTopicPost[];
    stream?: number[];
  };
  revisions?: Array<{
    version: number;
    created_at: string;
    username?: string;
    body_changes?: {
      inline?: string;
      side_by_side?: string;
    };
  }>;
}

export type TopicsResponse = DiscourseTopic | ApiErrorResponse;

export interface TopicsListSuccessResponse {
  topics: DiscourseTopic[];
  total?: number;
}

export type TopicsListResponse = TopicsListSuccessResponse | ApiErrorResponse;

// Alias for backwards compatibility
export type TopicsSuccessResponse = TopicsListSuccessResponse;

// ============================================
// Revision Types
// ============================================

export interface RevisionEntry {
  version: number;
  createdAt: string;
  username: string;
  bodyChanges?: string;
}

export interface RevisionsSuccessResponse {
  revisions: RevisionEntry[];
  postId: number;
}

export type RevisionsResponse = RevisionsSuccessResponse | ApiErrorResponse;

// ============================================
// User Types
// ============================================

export interface DiscourseUser {
  id: number;
  username: string;
  name: string | null;
  avatarTemplate: string;
  title?: string | null;
  admin?: boolean;
  moderator?: boolean;
  trustLevel?: number;
}

export type DiscourseUserSuccessResponse = DiscourseUserRawResponse & {
  user: NonNullable<DiscourseUserRawResponse["user"]>;
};

export type DiscourseUserResponse = DiscourseUserSuccessResponse | ApiErrorResponse;

// Raw API response type for user endpoint (snake_case from Discourse)
export interface DiscourseUserRawResponse {
  user?: {
    id?: number;
    username?: string;
    name?: string | null;
    avatar_template?: string;
    trust_level?: number;
    badge_count?: number;
    post_count?: number;
    time_read?: number;
    last_seen_at?: string | null;
    created_at?: string | null;
    title?: string | null;
    admin?: boolean;
    moderator?: boolean;
  };
  user_badges?: Array<{
    id: number;
    badge_id: number;
    badge?: { name?: string } | null;
  }>;
}
