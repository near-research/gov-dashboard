/**
 * Discourse Tools - Search, Fetch & Summarize
 */

import { servicesConfig } from "@/config/services";
import {
  discourseLatestTopics,
  discourseSearch,
  discourseTopic,
} from "@/server/plugins/discourse-client";
import {
  latestInputSchema,
  searchInputSchema,
} from "@/server/plugins/discourse-schemas";
import { z } from "zod";

// ============================================================================
// Configuration
// ============================================================================

const PROPOSALS_CATEGORY_ID = Number(
  process.env.DISCOURSE_PROPOSALS_CATEGORY_ID || 168
);

// ============================================================================
// Tool Definitions
// ============================================================================

export const DISCOURSE_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_discourse",
      description:
        "Search for specific posts by keywords, topics, or proposal IDs. Use this when user asks to 'search for', 'find posts about', or mentions specific keywords. DO NOT use for getting recent/latest proposals - use get_latest_topics instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Keywords or phrases to search for (proposal titles, topics, tags).",
          },
          limit: {
            type: "number",
            description:
              "Maximum number of search results to include (default 5).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_discourse_topic",
      description:
        "Get complete details of a specific topic including all posts and replies. Use when user asks about a specific topic ID, wants to 'see the discussion', 'read the thread', or 'show me topic X'.",
      parameters: {
        type: "object",
        properties: {
          topic_id: {
            type: "string",
            description: "The Discourse topic ID (e.g., '41773')",
          },
        },
        required: ["topic_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_latest_topics",
      description:
        "Get the most recent proposals from the governance forum. Use this whenever the user wants counts, recent activity, or 'what's new' in the proposals section. This is the primary tool for browsing proposals.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of topics to return (default 10, max 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_discussion",
      description:
        "Get AI-generated summary of community discussion on a topic. Use when user asks about 'sentiment', 'what people think', 'community feedback', 'reactions', or 'discussion summary'. Provides sentiment analysis and key points.",
      parameters: {
        type: "object",
        properties: {
          topic_id: {
            type: "string",
            description: "The Discourse topic ID to summarize",
          },
        },
        required: ["topic_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_reply",
      description:
        "Get brief summary of a single reply/comment. Use when user wants to understand a specific person's position or a particular comment without reading the full text.",
      parameters: {
        type: "object",
        properties: {
          post_id: {
            type: "string",
            description: "The post/reply ID to summarize",
          },
        },
        required: ["post_id"],
      },
    },
  },
] as const;

// ============================================================================
// System Prompt
// ============================================================================

export function buildDiscourseSystemPrompt(): string {
  return `**Discourse Forum Tools:**

You have powerful tools to explore the governance forum. Choose carefully:

**CRITICAL TOOL SELECTION:**
- If a new turn asks for "latest/recent/what's new" right after a search, ignore the previous search results and call **get_latest_topics** again; never recycle the old search list.
- Requests about what's new, trending, most popular/active, or any count/list of proposals → prefer **get_latest_topics** (use search only if the user insists on specific keywords).
- Requests to "search/find" proposals by keyword/author/topic → use **search_discourse**.
- "show me topic 123" / "discussion on proposal X" → use get_discourse_topic
- "what do people think" / "community sentiment" → use summarize_discussion
- "what did user X say" → use summarize_reply

**Available Tools:**
- **get_latest_topics**: Browse recent proposals (use for counting, listing, "what's new")
- **search_discourse**: Keyword search across all posts
- **get_discourse_topic**: Get full topic with all replies (20 posts max)
- **summarize_discussion**: AI summary of community feedback and sentiment
- **summarize_reply**: Brief summary of individual comment

**CRITICAL RESPONSE FORMAT:**

When you call **get_latest_topics** or **search_discourse** and receive a tool result with a "topics" array, your ENTIRE reply must be exactly the following two parts (in order):
1. A single sentence describing what you fetched (e.g., "Here are the latest proposals on NEAR governance.").
2. A JSON block (type = "proposal_list") that copies the tool's "topics" array verbatim. This block enables the UI to render cards, so do not alter the data structure.

Never echo raw tool request payloads (e.g., \`{"type":"search_discourse", ...}\`) back to the user. Do not repeat or summarize individual proposals outside the JSON block. Always include the sentence + JSON even if the user repeats the same request or the results haven't changed—never reply with "same as above". Output nothing else.

**Example response:**
Here are the latest proposals from the governance forum.
\`\`\`json
{
  "type": "proposal_list",
  "description": "Latest proposals sorted by activity.",
  "topics": [/* paste the topics array from the tool here */]
}
\`\`\`

**For other tools** (get_discourse_topic, summarize_discussion, summarize_reply), respond in natural language as usual.

**Citation format:**
Always provide direct links:
- Topics: https://gov.near.org/t/[slug]/[id]
- Specific posts: https://gov.near.org/t/[slug]/[id]/[post_number]

**Never call the same tool twice with identical arguments in one turn.**`;
}

// ============================================================================
// Helper Functions
// ============================================================================

const validationError = (message: string) => ({ result: { error: message } });

const SearchArgsSchema = searchInputSchema;

const LatestArgsSchema = latestInputSchema.extend({
  limit: z.number().int().positive().max(30).optional(),
});

const TopicIdSchema = z
  .object({
    topic_id: z
      .union([z.string(), z.number()])
      .transform((val) => Number(val))
      .refine((val) => Number.isFinite(val) && val > 0, "Invalid topic_id"),
  })
  .strict();

const SummarizeTopicSchema = z
  .object({
    topic_id: z.string().min(1),
  })
  .strict();

const SummarizeReplySchema = z
  .object({
    post_id: z.string().min(1),
  })
  .strict();

const stripHtml = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ============================================================================
// Result Types
// ============================================================================

export interface DiscourseSearchResult {
  type: "proposal_list";
  description: string;
  topics: Array<{
    id: number;
    title: string;
    slug: string;
    excerpt: string;
    author: string;
    created_at: string;
    topic_id: number;
    topic_slug: string;
    reply_count: number;
    views: number;
    last_posted_at: string;
  }>;
  total_count: number;
  query: string;
}

export interface DiscourseTopicResult {
  id: number;
  title: string;
  slug: string;
  posts_count: number;
  views: number;
  like_count: number;
  participant_count: number;
  created_at: string;
  last_posted_at: string;
  url: string;
  posts: Array<{
    id: number;
    post_number: number;
    username: string;
    content: string;
    created_at: string;
    like_count: number;
    reply_to_post_number?: number;
    reply_to_user?: string;
    url: string;
  }>;
}

export interface LatestTopicsResult {
  type: "proposal_list";
  description: string;
  topics: Array<{
    id: number;
    title: string;
    slug: string;
    excerpt: string;
    author: string;
    posts_count: number;
    reply_count: number;
    views: number;
    like_count: number;
    created_at: string;
    last_posted_at: string;
    url: string;
  }>;
  total_count: number;
}

export interface SummarizeDiscussionResult {
  topic_id: string;
  title: string;
  summary: string;
  reply_count: number;
  engagement: unknown;
  url: string;
}

export interface SummarizeReplyResult {
  post_id: string;
  author: string;
  post_number: number;
  summary: string;
  like_count: number;
  reply_to: unknown;
}

export interface DiscourseErrorResult {
  error: string;
}

// ============================================================================
// Tool Handlers
// ============================================================================

export async function handleSearchDiscourse(args: {
  query: string;
  limit?: number;
  before?: string;
  after?: string;
  username?: string;
  category?: string;
  tags?: string[];
  order?: "latest" | "likes" | "views" | "latest_topic";
  status?:
    | "open"
    | "closed"
    | "public"
    | "archived"
    | "noreplies"
    | "solved"
    | "unsolved";
  in?:
    | "title"
    | "likes"
    | "personal"
    | "messages"
    | "seen"
    | "unseen"
    | "posted"
    | "created"
    | "watching"
    | "tracking"
    | "bookmarks"
    | "first"
    | "pinned"
    | "wiki";
  page?: number;
  userApiKey?: string;
}): Promise<{ result: DiscourseSearchResult | DiscourseErrorResult }> {
  const parsed = SearchArgsSchema.safeParse(args);

  if (!parsed.success) {
    const unknownKeys = parsed.error.issues
      .filter((issue) => issue.code === "unrecognized_keys")
      .flatMap((issue) => (issue as any).keys || []);
    if (unknownKeys.length) {
      return validationError(
        `Unsupported parameter(s): ${unknownKeys.join(", ")}`
      );
    }
    const queryIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === "query" && issue.code === "too_small"
    );
    if (queryIssue) {
      return validationError("Search query is required");
    }
    const limitIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === "limit"
    );
    if (limitIssue?.code === "too_small") {
      return validationError("Limit must be greater than or equal to 1");
    }
    if (limitIssue?.code === "too_big") {
      return validationError("Limit must be less than or equal to 30");
    }
    return validationError(
      parsed.error.issues.map((issue) => issue.message).join("; ")
    );
  }

  const { query, limit: rawLimit, userApiKey, ...searchParams } = parsed.data;

  const limit = rawLimit ?? 5;
  const boundedLimit = Math.min(Math.max(limit, 1), 30);
  const renderLimit = Math.min(boundedLimit, 20);

  try {
    const { data, error, status } = await discourseSearch({
      ...searchParams,
      category: searchParams.category ?? PROPOSALS_CATEGORY_ID.toString(),
      userApiKey,
      query: query.trim(),
      limit: boundedLimit,
    });

    if (!data || error) {
      return {
        result: {
          error:
            error ??
            (status
              ? `Discourse search failed (${status})`
              : "Failed to search Discourse"),
        },
      };
    }

    const topicsById = new Map(
      (data.topics ?? []).map((topic) => [topic.id, topic])
    );
    const posts = Array.isArray(data.posts)
      ? data.posts.slice(0, boundedLimit)
      : [];

    const topics = posts.map((post) => {
      const topic = topicsById.get(post.topicId);
      const slug = topic?.slug || `topic-${post.topicId}`;
      const excerptSource = post.blurb || post.cooked || "";

      return {
        id: topic?.id ?? post.topicId ?? post.id,
        title: topic?.title ?? post.topicTitle ?? `Post #${post.id}`,
        slug,
        excerpt: stripHtml(excerptSource).slice(0, 400),
        author: post.username,
        created_at: topic?.createdAt ?? post.createdAt ?? "",
        topic_id: topic?.id ?? post.topicId ?? post.id,
        topic_slug: slug,
        reply_count: topic?.replyCount ?? post.replyCount ?? 0,
        views: topic?.views ?? 0,
        last_posted_at:
          topic?.lastPostedAt ?? post.updatedAt ?? post.createdAt ?? "",
      };
    });

    return {
      result: {
        type: "proposal_list",
        description: topics.length
          ? `Top ${topics.length} search results for "${query}".`
          : `No proposals found for "${query}".`,
        topics: topics.slice(0, renderLimit),
        total_count: data.totalResults ?? posts.length,
        query: query.trim(),
      },
    };
  } catch (error) {
    return {
      result: {
        error:
          error instanceof Error ? error.message : "Failed to search Discourse",
      },
    };
  }
}

export async function handleGetDiscourseTopic(args: {
  topic_id: string;
}): Promise<{ result: DiscourseTopicResult | DiscourseErrorResult }> {
  const parsed = TopicIdSchema.safeParse(args);
  if (!parsed.success) {
    return validationError(
      parsed.error.issues.map((i) => i.message).join("; ")
    );
  }

  const topicId = parsed.data.topic_id;

  try {
    const { data, error } = await discourseTopic({ topicId });

    if (!data || error) {
      return {
        result: {
          error: error ?? "Failed to fetch topic",
        },
      };
    }

    const posts = data.posts ?? [];
    const renderPosts = posts.slice(0, 20);
    const participantCount = new Set(renderPosts.map((post) => post.username))
      .size;

    return {
      result: {
        id: data.topic.id,
        title: data.topic.title,
        slug: data.topic.slug,
        posts_count: data.topic.postsCount,
        views: data.topic.views,
        like_count: data.topic.likeCount,
        participant_count: participantCount,
        created_at: renderPosts[0]?.createdAt ?? data.topic.createdAt ?? "",
        last_posted_at:
          data.topic.lastPostedAt ?? renderPosts[0]?.createdAt ?? "",
        url: `${servicesConfig.discourseBaseUrl}/t/${data.topic.slug}/${data.topic.id}`,
        posts: renderPosts.map((post) => ({
          id: post.id,
          post_number: post.postNumber,
          username: post.username,
          content: stripHtml(post.cooked || "").slice(0, 800),
          created_at: post.createdAt ?? "",
          like_count: post.likeCount ?? 0,
          reply_to_post_number: post.replyToPostNumber ?? undefined,
          reply_to_user: undefined,
          url: `${servicesConfig.discourseBaseUrl}/t/${data.topic.slug}/${data.topic.id}/${post.postNumber}`,
        })),
      },
    };
  } catch (error) {
    return {
      result: {
        error: error instanceof Error ? error.message : "Failed to fetch topic",
      },
    };
  }
}

export async function handleGetLatestTopics(
  args: {
    limit?: number;
    page?: number;
    order?: "default" | "created" | "activity" | "views" | "posts" | "likes";
    categoryId?: number;
  },
  _runtimeBaseUrl: string
): Promise<{ result: LatestTopicsResult | DiscourseErrorResult }> {
  const parsed = LatestArgsSchema.safeParse(args);
  if (!parsed.success) {
    const unknownKeys = parsed.error.issues
      .filter((issue) => issue.code === "unrecognized_keys")
      .flatMap((issue) => (issue as any).keys || []);
    if (unknownKeys.length) {
      return validationError(
        `Unsupported parameter(s): ${unknownKeys.join(", ")}`
      );
    }
    return validationError(
      parsed.error.issues.map((issue) => issue.message).join("; ")
    );
  }

  const limit = parsed.data.limit ?? 10;
  const boundedLimit = Math.min(Math.max(limit, 1), 30);
  const renderLimit = Math.min(boundedLimit, 20);

  try {
    const { data, error } = await discourseLatestTopics({
      categoryId: parsed.data.categoryId ?? PROPOSALS_CATEGORY_ID,
      page: parsed.data.page ?? 0,
      order: parsed.data.order ?? "default",
    });

    if (!data || error) {
      return {
        result: {
          error: error ?? "Failed to fetch latest topics",
        },
      };
    }

    return {
      result: {
        type: "proposal_list",
        description: `Latest ${limit} proposals by recent activity.`,
        topics:
          data.topics?.slice(0, renderLimit).map((topic) => ({
            id: topic.id,
            title: topic.title,
            slug: topic.slug,
            excerpt: stripHtml(topic.excerpt ?? "").slice(0, 400),
            author: topic.username ?? "unknown",
            posts_count: topic.postsCount,
            reply_count: topic.replyCount,
            views: topic.views,
            like_count: topic.likeCount,
            created_at: topic.createdAt ?? "",
            last_posted_at: topic.lastPostedAt ?? "",
            url: `${servicesConfig.discourseBaseUrl}/t/${topic.slug}/${topic.id}`,
          })) || [],
        total_count: data.topics?.length || 0,
      },
    };
  } catch (error) {
    return {
      result: {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch latest topics",
      },
    };
  }
}

export async function handleSummarizeDiscussion(
  args: { topic_id: string },
  runtimeBaseUrl: string
): Promise<{ result: SummarizeDiscussionResult | DiscourseErrorResult }> {
  const parsed = SummarizeTopicSchema.safeParse(args);
  if (!parsed.success) {
    return validationError(
      parsed.error.issues.map((issue) => issue.message).join("; ")
    );
  }

  const { topic_id } = parsed.data;

  try {
    const summaryUrl = new URL(
      `/api/discourse/topics/${encodeURIComponent(topic_id)}/summarize`,
      runtimeBaseUrl
    );

    const summaryResponse = await fetch(summaryUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!summaryResponse.ok) {
      throw new Error(
        `Failed to summarize discussion: ${summaryResponse.status}`
      );
    }
    const summaryData = await summaryResponse.json();

    return {
      result: {
        topic_id,
        title: summaryData.title,
        summary: summaryData.summary,
        reply_count: summaryData.replyCount,
        engagement: summaryData.engagement,
        url: `${servicesConfig.discourseBaseUrl}/t/${topic_id}`,
      },
    };
  } catch (error) {
    return {
      result: {
        error:
          error instanceof Error
            ? error.message
            : "Failed to summarize discussion",
      },
    };
  }
}

export async function handleSummarizeReply(
  args: { post_id: string },
  runtimeBaseUrl: string
): Promise<{ result: SummarizeReplyResult | DiscourseErrorResult }> {
  const parsed = SummarizeReplySchema.safeParse(args);
  if (!parsed.success) {
    return validationError(
      parsed.error.issues.map((issue) => issue.message).join("; ")
    );
  }

  const { post_id } = parsed.data;

  try {
    const replyUrl = new URL(
      `/api/discourse/replies/${encodeURIComponent(post_id)}/summarize`,
      runtimeBaseUrl
    );

    const replyResponse = await fetch(replyUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!replyResponse.ok) {
      throw new Error(`Failed to summarize reply: ${replyResponse.status}`);
    }

    const replyData = await replyResponse.json();

    return {
      result: {
        post_id,
        author: replyData.author,
        post_number: replyData.postNumber,
        summary: replyData.summary,
        like_count: replyData.likeCount,
        reply_to: replyData.replyTo,
      },
    };
  } catch (error) {
    return {
      result: {
        error:
          error instanceof Error ? error.message : "Failed to summarize reply",
      },
    };
  }
}
