import "server-only";

import { createPluginRuntime } from "every-plugin";
import { logger } from "@/lib/logger";
import { DISCOURSE_URLS } from "@/constants/services";

const normalizeFileSchemeUrl = (rawUrl: string) => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (!trimmed.toLowerCase().startsWith("file:")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "file:") {
      return trimmed;
    }
    const searchHash = `${parsed.search}${parsed.hash}`.replace(/^\s*/, "");
    return `file://${parsed.pathname}${searchHash}`;
  } catch {
    if (trimmed.toLowerCase().startsWith("file:///")) {
      return trimmed;
    }
    const withoutScheme = trimmed.slice("file://".length);
    return `file:///${withoutScheme}`;
  }
};

const normalizeRemoteEntryUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  const normalized = normalizeFileSchemeUrl(trimmed);
  if (normalized.endsWith(".js")) {
    return normalized;
  }

  const base = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  return `${base}/remoteEntry.js`;
};

const getDiscourseBaseUrl = () =>
  normalizeFileSchemeUrl(
    process.env.DISCOURSE_URL || DISCOURSE_URLS.PRODUCTION
  );

type DiscoursePluginRuntime = ReturnType<typeof createPluginRuntime>;
type DiscourseRuntimeResult = Awaited<
  ReturnType<DiscoursePluginRuntime["usePlugin"]>
>;

export type DiscourseRouter = DiscourseRuntimeResult["router"];
export type DiscourseClient = DiscourseRuntimeResult["client"];

// Type-safe access to global mocks (for testing)
const getGlobalMock = <T>(key: string): T | undefined =>
  (globalThis as Record<string, unknown>)[key] as T | undefined;

const truthyValues = new Set(["1", "true", "yes", "on"]);
const truthyEnv = (value?: string) =>
  Boolean(value && truthyValues.has(value.trim().toLowerCase()));

const isTestEnvironment =
  Boolean(process.env.VITEST) ||
  process.env.NODE_ENV === "test" ||
  truthyEnv(process.env.PLAYWRIGHT_TEST);

const createFallbackDiscourseRouter = (): DiscourseRouter =>
  ({
    initiateLink: async () => null,
    getUserApiAuthUrl: async () => null,
    completeLink: async () => null,
    getLinkage: async () => null,
    ping: async () => null,
    createPost: async () => null,
    getLatestTopics: async () => ({
      topics: [],
      hasMore: false,
    }),
    getTopic: async () => null,
    getPost: async () => null,
    getPostReplies: async () => ({
      post: null,
      replies: [],
    }),
    getCategories: async () => ({
      categories: [],
    }),
    getCategory: async () => ({
      category: null,
      subcategories: [],
    }),
    getTags: async () => ({
      tags: [],
    }),
    search: async () => ({
      posts: [],
      topics: [],
      users: [],
      categories: [],
      totalResults: 0,
    }),
    linkageStore: {
      unlink: async () => null,
    },
  } satisfies DiscourseRouter);

const createFallbackDiscourseClient = (): DiscourseClient =>
  ({
    search: async () => ({ error: "discourse-mock" }),
    latestTopics: async () => ({ error: "discourse-mock" }),
    topic: async () => ({ error: "discourse-mock" }),
    post: async () => ({ error: "discourse-mock" }),
    replies: async () => ({ error: "discourse-mock" }),
    categories: async () => ({ error: "discourse-mock" }),
    category: async () => ({ error: "discourse-mock" }),
    tags: async () => ({ error: "discourse-mock" }),
  } satisfies DiscourseClient);

const getTestRouter = (): DiscourseRouter =>
  getGlobalMock<DiscourseRouter>("__mockDiscourseRouter") ??
  createFallbackDiscourseRouter();

const getTestClient = (): DiscourseClient =>
  getGlobalMock<DiscourseClient>("__mockDiscourseClient") ??
  createFallbackDiscourseClient();

const remoteDefaults = {
  baseUrl: getDiscourseBaseUrl(),
  apiUsername: process.env.DISCOURSE_API_USERNAME || "gov",
  clientId: process.env.DISCOURSE_CLIENT_ID || "discourse-plugin",
};

const discourseApiKey =
  process.env.DISCOURSE_API_KEY || "test-discourse-api-key";

let discourseRouter: DiscourseRouter;
let discourseClient: DiscourseClient;

if (isTestEnvironment) {
  discourseRouter = getTestRouter();
  discourseClient = getTestClient();
} else {
  const remoteEntryUrl =
    process.env.DISCOURSE_PLUGIN_URL ||
    "https://jlwaugh-70-discourse-plugin-discourse-plugin-near-e38bf3951-ze.zephyrcloud.app/remoteEntry.js";
  const normalizedRemoteEntryUrl = normalizeRemoteEntryUrl(remoteEntryUrl);

  if (!process.env.DISCOURSE_PLUGIN_URL) {
    logger.warn(
      "[discourse-plugin] Using baked-in remote entry; set DISCOURSE_PLUGIN_URL to override."
    );
  }

  const runtime = createPluginRuntime({
    registry: { "discourse-plugin": { remoteUrl: normalizedRemoteEntryUrl } },
    secrets: {
      DISCOURSE_API_KEY: discourseApiKey,
    },
  });

  const shutdownRuntime = () => {
    runtime.shutdown().catch((error) => {
      logger.error("[discourse-plugin] runtime shutdown error", error);
    });
  };

  if (typeof process !== "undefined") {
    process.once("SIGTERM", shutdownRuntime);
    process.once("SIGINT", shutdownRuntime);
  }

  const plugin = await runtime.usePlugin("discourse-plugin", {
    variables: {
      discourseBaseUrl: remoteDefaults.baseUrl,
      discourseApiUsername: remoteDefaults.apiUsername,
      clientId: remoteDefaults.clientId,
    },
    secrets: { discourseApiKey },
  });
  logger.debug(
    "[discourse-plugin] loaded router keys",
    Object.keys(plugin.router).sort()
  );
  logger.debug(
    "[discourse-plugin] createPost type",
    typeof (plugin.router as Record<string, unknown>).createPost
  );

  discourseRouter = plugin.router;
  discourseClient = plugin.client;
}

export { getDiscourseBaseUrl };
export { discourseRouter, discourseClient };
