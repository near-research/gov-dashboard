/**
 * Shared types for Discourse REST responses.
 * These cover only the fields we actually read in the app, keeping them lean but useful.
 */

export interface DiscourseActionSummary {
  id: number;
  count?: number;
}

export interface DiscourseUserRef {
  id: number;
  username: string;
}

export interface DiscoursePost {
  id: number;
  post_number: number;
  username: string;
  cooked: string;
  created_at: string;
  like_count?: number;
  actions_summary?: DiscourseActionSummary[];
  reply_count?: number;
  reply_to_post_number?: number | null;
  reply_to_user?: DiscourseUserRef | null;
  avatar_template?: string | null;
  version?: number;
  topic_id?: number;
}

export interface DiscoursePostStream {
  posts: DiscoursePost[];
}

export interface DiscoursePostDetail extends DiscoursePost {
  raw?: string;
}

export interface DiscourseTopic {
  id: number;
  title: string;
  slug: string;
  posts_count: number;
  views: number;
  last_posted_at?: string;
  like_count?: number;
  actions_summary?: DiscourseActionSummary[];
  post_stream: DiscoursePostStream;
  category_id?: number;
  participant_count?: number;
}

export interface DiscourseTopicListTopic {
  id: number;
  title: string;
  slug: string;
  excerpt?: string;
  created_at: string;
  posts_count?: number;
  reply_count?: number;
  views?: number;
  last_posted_at?: string;
  like_count?: number;
  pinned?: boolean;
  closed?: boolean;
  archived?: boolean;
  visible?: boolean;
  category_id?: number;
  posters?: Array<{
    user_id: number;
  }>;
}

export interface DiscourseTopicList {
  per_page?: number;
  can_create_topic?: boolean;
  topics: DiscourseTopicListTopic[];
}

export interface DiscourseTopicListResponse {
  topic_list?: DiscourseTopicList;
  users?: DiscourseUserRef[];
}

export interface DiscourseCategory {
  id: number;
  name: string;
  slug: string;
  color?: string;
  text_color?: string;
  parent_category_id?: number | null;
  description?: string;
}

export interface DiscourseTag {
  id?: number;
  name: string;
  count?: number;
  pm_count?: number;
}

export interface DiscourseGroup {
  id: number;
  name: string;
  full_name?: string;
  user_count?: number;
}

export interface LatestPostSummary {
  id: number;
  title: string;
  excerpt: string;
  created_at: string;
  username: string;
  topic_id: number;
  topic_slug: string;
  reply_count: number;
  views: number;
  last_posted_at: string;
  like_count: number;
  posts_count: number;
  pinned: boolean;
  closed: boolean;
  archived: boolean;
  visible: boolean;
  category_id?: number;
}

export interface LatestPostsResponse {
  latest_posts: LatestPostSummary[];
  can_create_topic: boolean;
  per_page: number;
}

export interface DiscourseGroupedSearchResult {
  more_posts?: string;
  more_users?: string;
  more_categories?: string;
  term?: string;
  search_log_id?: number;
  more_full_page_results?: string;
  can_create_topic?: boolean;
  error?: string;
  extra?: Record<string, unknown>;
  post_ids?: number[];
  user_ids?: number[];
  category_ids?: number[];
  tag_ids?: number[];
  group_ids?: number[];
}

export interface DiscourseSearchResponse {
  posts: DiscoursePost[];
  users: DiscourseUserRef[];
  categories: DiscourseCategory[];
  tags: DiscourseTag[];
  groups: DiscourseGroup[];
  grouped_search_result: DiscourseGroupedSearchResult;
}

export interface RevisionBodyChange {
  inline?: string;
  side_by_side?: string;
  side_by_side_markdown?: string;
}

export interface RevisionTitleChange {
  inline?: string;
  previous?: string;
  current?: string;
}

export interface DiscourseRevision {
  version: number;
  created_at: string;
  username: string;
  edit_reason?: string;
  body_changes?: RevisionBodyChange;
  title_changes?: RevisionTitleChange;
}

export interface DiscourseRevisionResponse {
  post_id: number;
  revisions: DiscourseRevision[];
  total_revisions: number;
  current_version: number;
}
