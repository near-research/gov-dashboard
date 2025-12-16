import { z } from "zod";

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

export const searchInputSchema = z
  .object({
    query: z.string().trim().min(1),
    category: z.string().optional(),
    username: z.string().optional(),
    tags: z.array(z.string()).optional(),
    before: z.string().optional(),
    after: z.string().optional(),
    order: z.enum(["latest", "likes", "views", "latest_topic"]).optional(),
    status: z
      .enum([
        "open",
        "closed",
        "public",
        "archived",
        "noreplies",
        "solved",
        "unsolved",
      ])
      .optional(),
    in: z
      .enum([
        "title",
        "likes",
        "personal",
        "messages",
        "seen",
        "unseen",
        "posted",
        "created",
        "watching",
        "tracking",
        "bookmarks",
        "first",
        "pinned",
        "wiki",
      ])
      .optional(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
    userApiKey: z.string().min(1).optional(),
  })
  .strict();

export const latestInputSchema = z
  .object({
    categoryId: z.number().int().positive().optional(),
    page: z.number().int().nonnegative().default(0),
    order: z
      .enum(["default", "created", "activity", "views", "posts", "likes"])
      .default("default"),
  })
  .strict();

export const topicInputSchema = z
  .object({
    topicId: z.number().int().positive(),
  })
  .strict();

export const postInputSchema = z
  .object({
    postId: z.number().int().positive(),
    includeRaw: z.boolean().default(false),
  })
  .strict();

export const categoryInputSchema = z
  .object({
    idOrSlug: z.union([z.number().int().positive(), z.string().min(1)]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Output schemas
// ---------------------------------------------------------------------------

export const TopicSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  categoryId: z.number().nullable(),
  createdAt: z.string().nullable(),
  lastPostedAt: z.string().nullable(),
  postsCount: z.number(),
  replyCount: z.number(),
  likeCount: z.number(),
  views: z.number(),
  pinned: z.boolean(),
  closed: z.boolean(),
  archived: z.boolean(),
  visible: z.boolean(),
  excerpt: z.string().optional(),
  username: z.string().optional(),
});

export const PaginatedTopicsSchema = z.object({
  topics: z.array(TopicSchema),
  hasMore: z.boolean(),
  nextPage: z.number().nullable(),
  canCreateTopic: z.boolean().optional(),
});

export const PostSchema = z.object({
  id: z.number(),
  topicId: z.number(),
  postNumber: z.number(),
  username: z.string(),
  name: z.string().nullable(),
  avatarTemplate: z.string(),
  raw: z.string().optional(),
  cooked: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  replyCount: z.number(),
  likeCount: z.number(),
  replyToPostNumber: z.number().nullable(),
  canEdit: z.boolean().optional(),
  version: z.number(),
});

export const PaginatedPostsSchema = z.object({
  posts: z.array(PostSchema),
  hasMore: z.boolean(),
  nextPage: z.number().nullable(),
});

export const CategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  topicCount: z.number(),
  postCount: z.number(),
  parentCategoryId: z.number().nullable(),
  readRestricted: z.boolean(),
});

export const TagSchema = z.object({
  id: z.number(),
  name: z.string(),
  topicCount: z.number(),
  pmTopicCount: z.number(),
  synonyms: z.array(z.string()),
  targetTag: z.string().nullable(),
  description: z.string().nullable(),
});

const DiscourseUserSchema = z.object({
  id: z.number(),
  username: z.string(),
});

export const SearchPostSchema = z.object({
  topicTitle: z.string(),
  blurb: z.string(),
  id: z.number(),
  topicId: z.number(),
  postNumber: z.number(),
  username: z.string(),
  name: z.string().nullable(),
  avatarTemplate: z.string(),
  raw: z.string().optional(),
  cooked: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  replyCount: z.number(),
  likeCount: z.number(),
  replyToPostNumber: z.number().nullable(),
  canEdit: z.boolean().optional(),
  version: z.number(),
});

export const SearchResultSchema = z.object({
  posts: z.array(SearchPostSchema),
  topics: z.array(TopicSchema),
  users: z.array(DiscourseUserSchema).optional().default([]),
  categories: z.array(CategorySchema).optional().default([]),
  totalResults: z.number(),
  hasMore: z.boolean(),
  nextPage: z.number().nullable().optional(),
});

export const TopicResultSchema = z.object({
  topic: TopicSchema,
  posts: z.array(PostSchema).optional(),
});

export const PostResultSchema = z.object({
  post: PostSchema,
  topic: TopicSchema,
});

export const RepliesResultSchema = z.object({
  replies: z.array(PostSchema),
  hasMore: z.boolean().optional(),
  nextPage: z.number().nullable().optional(),
});

export type Topic = z.infer<typeof TopicSchema>;
export type PaginatedTopics = z.infer<typeof PaginatedTopicsSchema>;
export type Post = z.infer<typeof PostSchema>;
export type PaginatedPosts = z.infer<typeof PaginatedPostsSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Tag = z.infer<typeof TagSchema>;
export type SearchPost = z.infer<typeof SearchPostSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const DiscourseActionSummarySchema = z.object({
  id: z.number(),
  count: z.number().optional(),
});

export const DiscourseUserRefSchema = z.object({
  id: z.number(),
  username: z.string(),
});

export const DiscoursePostSchema = z.object({
  id: z.number(),
  post_number: z.number(),
  username: z.string(),
  cooked: z.string(),
  created_at: z.string(),
  like_count: z.number().nullable().optional(),
  actions_summary: z.array(DiscourseActionSummarySchema).optional(),
  reply_count: z.number().optional(),
  reply_to_post_number: z.number().nullable().optional(),
  reply_to_user: DiscourseUserRefSchema.nullable().optional(),
  avatar_template: z.string().nullable().optional(),
  version: z.number().optional(),
  topic_id: z.number().optional(),
  topic_title: z.string().optional(),
  topic_slug: z.string().optional(),
  topic_posts_count: z.number().nullable().optional(),
  topic_reply_count: z.number().nullable().optional(),
  topic_views: z.number().nullable().optional(),
  topic_bumped_at: z.string().nullable().optional(),
});

export const DiscoursePostStreamSchema = z.object({
  posts: z.array(DiscoursePostSchema),
});

export const DiscourseTopicDetailSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  posts_count: z.number().optional(),
  views: z.number().optional(),
  last_posted_at: z.string().nullable().optional(),
  like_count: z.number().optional(),
  actions_summary: z.array(DiscourseActionSummarySchema).optional(),
  post_stream: DiscoursePostStreamSchema,
  category_id: z.number().optional(),
  participant_count: z.number().optional(),
  url: z.string().optional(),
  current_revision: z.number().optional(),
  revisions: z
    .array(
      z.object({
        version: z.number(),
        created_at: z.string(),
      })
    )
    .optional(),
});

export const DiscourseUserDetailSchema = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string().optional(),
  avatar_template: z.string().optional(),
});

export type DiscoursePost = z.infer<typeof DiscoursePostSchema>;
export type DiscoursePostStream = z.infer<typeof DiscoursePostStreamSchema>;
export type DiscourseTopicDetail = z.infer<typeof DiscourseTopicDetailSchema>;
export type DiscourseUserDetail = z.infer<typeof DiscourseUserDetailSchema>;
