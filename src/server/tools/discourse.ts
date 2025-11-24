/**
 * Discourse Tools - Search, Fetch & Summarize
 */

import { servicesConfig } from "@/config/services";
import type { DiscourseSearchResponse } from "@/types/discourse";

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
}): Promise<{ result: DiscourseSearchResult | DiscourseErrorResult }> {
  const { query, limit: rawLimit } = args;

  if (!query?.trim()) {
    return { result: { error: "Search query is required" } };
  }

  const limit = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 5);
  const boundedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10) : 5;

  try {
    const searchUrl = new URL(`${servicesConfig.discourseBaseUrl}/search.json`);
    searchUrl.searchParams.set("q", query.trim());
    searchUrl.searchParams.set("search_context[type]", "category");
    searchUrl.searchParams.set(
      "search_context[id]",
      PROPOSALS_CATEGORY_ID.toString()
    );

    const response = await fetch(searchUrl.toString(), {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Discourse API error: ${response.status}`);
    }

    const data = (await response.json()) as DiscourseSearchResponse;
    const posts = Array.isArray(data.posts)
      ? data.posts.slice(0, boundedLimit)
      : [];

    const topics = posts.map((post) => ({
      id: post.topic_id ?? post.id,
      title: post.topic_title || `Post #${post.id}` || `Result ${post.id}`,
      slug:
        post.topic_slug ||
        (post.topic_id ? `topic-${post.topic_id}` : `post-${post.id}`),
      excerpt: stripHtml(post.cooked || "").slice(0, 400),
      author: post.username,
      created_at: post.created_at,
      topic_id: post.topic_id ?? post.id,
      topic_slug:
        post.topic_slug ||
        (post.topic_id ? `${post.topic_id}` : `post-${post.id}`),
      reply_count:
        post.reply_count ??
        post.topic_posts_count ??
        post.topic_reply_count ??
        0,
      views: post.topic_views ?? 0,
      last_posted_at: post.topic_bumped_at ?? post.created_at,
    }));

    return {
      result: {
        type: "proposal_list",
        description: topics.length
          ? `Top ${topics.length} search results for "${query}".`
          : `No proposals found for "${query}".`,
        topics,
        total_count:
          data.grouped_search_result?.post_ids?.length || posts.length,
        query,
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
  const { topic_id } = args;

  try {
    const topicResponse = await fetch(
      `${servicesConfig.discourseBaseUrl}/t/${topic_id}.json`
    );

    if (!topicResponse.ok) {
      throw new Error(`Failed to fetch topic: ${topicResponse.status}`);
    }

    const topic = await topicResponse.json();
    const posts = topic.post_stream?.posts || [];

    return {
      result: {
        id: topic.id,
        title: topic.title,
        slug: topic.slug,
        posts_count: topic.posts_count,
        views: topic.views,
        like_count: topic.like_count,
        participant_count: topic.participant_count,
        created_at: topic.post_stream?.posts?.[0]?.created_at,
        last_posted_at: topic.last_posted_at,
        url: `${servicesConfig.discourseBaseUrl}/t/${topic.slug}/${topic.id}`,
        posts: posts.slice(0, 20).map((post: any) => ({
          id: post.id,
          post_number: post.post_number,
          username: post.username,
          content: stripHtml(post.cooked || "").slice(0, 800),
          created_at: post.created_at,
          like_count:
            post.actions_summary?.find((a: any) => a.id === 2)?.count || 0,
          reply_to_post_number: post.reply_to_post_number,
          reply_to_user: post.reply_to_user?.username,
          url: `${servicesConfig.discourseBaseUrl}/t/${topic.slug}/${topic.id}/${post.post_number}`,
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
  args: { limit?: number },
  runtimeBaseUrl: string
): Promise<{ result: LatestTopicsResult | DiscourseErrorResult }> {
  const limit = typeof args.limit === "number" ? Math.min(args.limit, 30) : 10;

  try {
    const latestResponse = await fetch(
      `${runtimeBaseUrl}/api/discourse/latest?per_page=${limit}`
    );

    if (!latestResponse.ok) {
      throw new Error(
        `Failed to fetch latest topics: ${latestResponse.status}`
      );
    }

    const data = await latestResponse.json();

    return {
      result: {
        type: "proposal_list",
        description: `Latest ${limit} proposals by recent activity.`,
        topics:
          data.latest_posts?.slice(0, limit).map((topic: any) => ({
            id: topic.topic_id,
            title: topic.title,
            slug: topic.topic_slug,
            excerpt: topic.excerpt,
            author: topic.username,
            posts_count: topic.posts_count,
            reply_count: topic.reply_count,
            views: topic.views,
            like_count: topic.like_count,
            created_at: topic.created_at,
            last_posted_at: topic.last_posted_at,
            url: `${servicesConfig.discourseBaseUrl}/t/${topic.topic_slug}/${topic.topic_id}`,
          })) || [],
        total_count: data.latest_posts?.length || 0,
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
  const { topic_id } = args;

  try {
    const summaryResponse = await fetch(
      `${runtimeBaseUrl}/api/discourse/topics/${topic_id}/summarize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );

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
  const { post_id } = args;

  try {
    const replyResponse = await fetch(
      `${runtimeBaseUrl}/api/discourse/replies/${post_id}/summarize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );

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
