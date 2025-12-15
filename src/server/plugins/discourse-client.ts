// Optional server-only hint; falls back silently in test/runtime environments
import("server-only").catch(() => {
  // noop when module is unavailable (e.g., test runner)
});

import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { DISCOURSE_RENDER_LIMIT, clampRenderLimit } from "@/config/discourse";
import { logger } from "@/lib/logger";
import {
  CategorySchema,
  categoryInputSchema,
  latestInputSchema,
  PaginatedTopicsSchema,
  PostResultSchema,
  postInputSchema,
  RepliesResultSchema,
  searchInputSchema,
  SearchResultSchema,
  TagSchema,
  TopicSchema,
  TopicResultSchema,
  topicInputSchema,
  type Category,
  type PaginatedPosts,
  type PaginatedTopics,
  type Post,
  type SearchPost,
  type SearchResult,
  type Tag,
  type Topic,
} from "./discourse-schemas";
import {
  discourseClient as importedDiscourseClient,
  type DiscourseClient,
} from "./discourse";

export type {
  Topic,
  PaginatedTopics,
  Post,
  PaginatedPosts,
  Category,
  Tag,
  SearchPost,
  SearchResult,
} from "./discourse-schemas";

type ClientResult<T> = { data?: T; error?: string; status?: number };

const parseInput = <T extends z.ZodTypeAny>(
  schema: T,
  input: unknown
): { data: z.infer<T> | null; error?: ClientResult<never> } => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: validationFailure(
        parsed.error.issues.map((i) => i.message).join("; ")
      ),
    };
  }
  return { data: parsed.data };
};

const parseOutput = <T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  message: string
): { data: z.infer<T> | null; error?: ClientResult<never> } => {
  const parsed = schema.safeParse(data);
  return parsed.success
    ? { data: parsed.data }
    : { data: null, error: validationFailure(message) };
};

const capCollection = <T>(items: T[] | undefined, limit: number) =>
  Array.isArray(items) ? items.slice(0, limit) : [];

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

const statusForCode: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
};

const friendlyMessageForCode: Record<string, string> = {
  BAD_REQUEST: "We couldn't process that request.",
  UNAUTHORIZED: "Please sign in to continue.",
  FORBIDDEN: "You don't have permission for this action.",
  NOT_FOUND: "The requested resource was not found.",
  RATE_LIMITED: "Too many requests—please try again shortly.",
  SERVICE_UNAVAILABLE: "Service is temporarily unavailable—try again later.",
};

function toClientError(error: unknown): ClientResult<never> {
  const defaultMessage = "Unexpected error—please try again.";

  logger.error("[discourse-client] Error:", error);

  if (error instanceof ORPCError) {
    const status = statusForCode[error.code] ?? 500;
    const message = friendlyMessageForCode[error.code] ?? defaultMessage;
    const isTest = process.env.NODE_ENV === "test";
    const loggable = status >= 500 || !friendlyMessageForCode[error.code];
    if (!isTest && loggable) {
      const log = status >= 500 ? logger.error : logger.warn;
      log("[discourse] ORPCError", { code: error.code, status, error });
    }
    return {
      error: message,
      status,
    };
  }

  if (
    error instanceof TypeError &&
    error.message.includes("is not a function")
  ) {
    logger.error("[discourse-client] Method not found:", error.message);
    return { error: "Service configuration error", status: 500 };
  }

  if (error instanceof Error) {
    logger.error("[discourse] Error", error);
    return { error: defaultMessage };
  }

  logger.error("[discourse] Unknown error", error);
  return { error: defaultMessage };
}

function validationFailure(issueMessage: string): ClientResult<never> {
  return { error: issueMessage, status: 400 };
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export const createDiscourseClientWrapper = (
  clientFactory: () => Promise<DiscourseClient>
) => {
  let clientPromise: Promise<DiscourseClient> | null = null;

  const getClient = async () => {
    if (!clientPromise) {
      clientPromise = clientFactory();
    }
    try {
      const client = await clientPromise;

      const requiredMethods = [
        "search",
        "getLatestTopics",
        "getTopic",
        "getPost",
        "getPostReplies",
        "getCategories",
        "getCategory",
        "getTags",
      ];

      for (const method of requiredMethods) {
        if (typeof (client as Record<string, unknown>)[method] !== "function") {
          logger.error(`[discourse-client] Missing method: ${method}`);
          throw new Error(`Discourse client missing method: ${method}`);
        }
      }

      return client;
    } catch (error) {
      clientPromise = null;
      throw error;
    }
  };

  const discourseSearch = async (
    input: z.input<typeof searchInputSchema>
  ): Promise<ClientResult<SearchResult>> => {
    const parsed = parseInput(searchInputSchema, input);
    if (!parsed.data) return parsed.error!;

    const { limit, ...searchParams } = parsed.data;
    const renderLimit = clampRenderLimit(limit);

    try {
      const client = await getClient();
      const routerInput: Record<string, unknown> = {
        ...searchParams,
        page: parsed.data.page,
      };
      const data = await client.search(routerInput);
      const parsedData = parseOutput(
        SearchResultSchema,
        data,
        "Invalid search response"
      );
      if (!parsedData.data) return parsedData.error!;

      const { posts, topics, ...rest } = parsedData.data;
      return {
        data: {
          ...rest,
          posts: capCollection(posts, renderLimit),
          topics: capCollection(topics, renderLimit),
        },
      };
    } catch (error) {
      return toClientError(error);
    }
  };

  const discourseLatestTopics = async (
    input: z.input<typeof latestInputSchema>
  ): Promise<ClientResult<PaginatedTopics>> => {
    const parsed = parseInput(latestInputSchema, input);
    if (!parsed.data) return parsed.error!;

    try {
      const client = await getClient();
      const data = await client.getLatestTopics(parsed.data);
      const parsedData = parseOutput(
        PaginatedTopicsSchema,
        data,
        "Invalid latest topics response"
      );
      return parsedData.data
        ? {
            data: {
              ...parsedData.data,
              topics: capCollection(
                parsedData.data.topics,
                DISCOURSE_RENDER_LIMIT
              ),
            },
          }
        : parsedData.error!;
    } catch (error) {
      return toClientError(error);
    }
  };

  const discourseTopic = async (
    input: z.input<typeof topicInputSchema>
  ): Promise<ClientResult<z.infer<typeof TopicResultSchema>>> => {
    const parsed = parseInput(topicInputSchema, input);
    if (!parsed.data) return parsed.error!;

    try {
      const client = await getClient();
      const data = await client.getTopic(parsed.data);
      const parsedData = parseOutput(
        TopicResultSchema,
        data,
        "Invalid topic response"
      );
      if (!parsedData.data) return parsedData.error!;

      const posts = capCollection(
        parsedData.data.posts,
        DISCOURSE_RENDER_LIMIT
      );
      return { data: posts ? { ...parsedData.data, posts } : parsedData.data };
    } catch (error) {
      return toClientError(error);
    }
  };

  const discoursePost = async (
    input: z.input<typeof postInputSchema>
  ): Promise<ClientResult<z.infer<typeof PostResultSchema>>> => {
    const parsed = parseInput(postInputSchema, input);
    if (!parsed.data) return parsed.error!;

    try {
      const client = await getClient();
      const data = await client.getPost(parsed.data);
      const parsedData = parseOutput(
        PostResultSchema,
        data,
        "Invalid post response"
      );
      return parsedData.data ? { data: parsedData.data } : parsedData.error!;
    } catch (error) {
      return toClientError(error);
    }
  };

  const discourseReplies = async (
    input: z.input<typeof postInputSchema>
  ): Promise<ClientResult<PaginatedPosts>> => {
    const parsed = parseInput(postInputSchema, input);
    if (!parsed.data) return parsed.error!;

    try {
      const client = await getClient();
      const data = await client.getPostReplies(parsed.data);
      const parsedData = parseOutput(
        RepliesResultSchema,
        data,
        "Invalid replies response"
      );
      return parsedData.data
        ? {
            data: {
              posts: capCollection(
                parsedData.data.replies,
                DISCOURSE_RENDER_LIMIT
              ),
              hasMore: parsedData.data.hasMore ?? false,
              nextPage: parsedData.data.nextPage ?? null,
            },
          }
        : parsedData.error!;
    } catch (error) {
      return toClientError(error);
    }
  };

  const discourseCategories = async (): Promise<
    ClientResult<{ categories: Category[] }>
  > => {
    try {
      const client = await getClient();
      const data = await client.getCategories();
      const parsed = parseOutput(
        z.object({ categories: z.array(CategorySchema) }),
        data,
        "Invalid categories response"
      );
      return parsed.data ? { data: parsed.data } : parsed.error!;
    } catch (error) {
      return toClientError(error);
    }
  };

  const discourseCategory = async (
    input: z.input<typeof categoryInputSchema>
  ): Promise<
    ClientResult<{ category: Category; subcategories: Category[] }>
  > => {
    const parsed = parseInput(categoryInputSchema, input);
    if (!parsed.data) return parsed.error!;

    try {
      const client = await getClient();
      const data = await client.getCategory(parsed.data);
      const parsedData = parseOutput(
        z.object({
          category: CategorySchema,
          subcategories: z.array(CategorySchema),
        }),
        data,
        "Invalid category response"
      );

      return parsedData.data ? { data: parsedData.data } : parsedData.error!;
    } catch (error) {
      return toClientError(error);
    }
  };

  const discourseTags = async (): Promise<ClientResult<{ tags: Tag[] }>> => {
    try {
      const client = await getClient();
      const data = await client.getTags();

      const parsed = parseOutput(
        z.object({ tags: z.array(TagSchema) }),
        data,
        "Invalid tags response"
      );
      return parsed.data ? { data: parsed.data } : parsed.error!;
    } catch (error) {
      return toClientError(error);
    }
  };

  return {
    search: discourseSearch,
    latestTopics: discourseLatestTopics,
    topic: discourseTopic,
    post: discoursePost,
    replies: discourseReplies,
    categories: discourseCategories,
    category: discourseCategory,
    tags: discourseTags,
  };
};

const discourseClientWrapper = createDiscourseClientWrapper(() =>
  Promise.resolve(importedDiscourseClient)
);

export const {
  search: discourseSearch,
  latestTopics: discourseLatestTopics,
  topic: discourseTopic,
  post: discoursePost,
  replies: discourseReplies,
  categories: discourseCategories,
  category: discourseCategory,
  tags: discourseTags,
} = discourseClientWrapper;

export default discourseClientWrapper;
