import "server-only";

import { createPluginRuntime } from "every-plugin";

type DiscoursePluginRuntime = ReturnType<typeof createPluginRuntime>;
type DiscourseRuntimeResult = Awaited<
  ReturnType<DiscoursePluginRuntime["usePlugin"]>
>;

export type DiscourseRouter = DiscourseRuntimeResult["router"];
export type DiscourseClient = DiscourseRuntimeResult["client"];

// Type-safe access to global mocks (for testing)
const getGlobalMock = <T>(key: string): T | undefined =>
  (globalThis as Record<string, unknown>)[key] as T | undefined;

const isTestEnvironment =
  Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

import { getDiscourseBaseUrl, normalizeFileSchemeUrl } from "./discourse-url";

const createFallbackDiscourseRouter = (): DiscourseRouter =>
  ({
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
  } as unknown as DiscourseRouter);

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
  } as unknown as DiscourseClient);

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

let discourseRouter: DiscourseRouter;
let discourseClient: DiscourseClient;

if (isTestEnvironment) {
  discourseRouter = getTestRouter();
  discourseClient = getTestClient();
} else {
  const remoteUrl = normalizeFileSchemeUrl(
    process.env.DISCOURSE_PLUGIN_URL ||
      "https://jlwaugh-66-discourse-plugin-discourse-plugin-near-d025bb0db-ze.zephyrcloud.app/remoteEntry.js"
  );

  if (!process.env.DISCOURSE_PLUGIN_URL) {
    console.warn(
      "[discourse-plugin] Using baked-in remote entry; set DISCOURSE_PLUGIN_URL to override."
    );
  }

  const runtime = createPluginRuntime({
    registry: { "discourse-plugin": { remoteUrl } },
    secrets: {
      DISCOURSE_API_KEY:
        process.env.DISCOURSE_API_KEY || "test-discourse-api-key",
    },
  });

  const shutdownRuntime = () => {
    runtime.shutdown().catch((error) => {
      console.error("[discourse-plugin] runtime shutdown error", error);
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
    secrets: { discourseApiKey: "{{DISCOURSE_API_KEY}}" },
  });

  discourseRouter = plugin.router;
  discourseClient = plugin.client;
}

export { discourseRouter, discourseClient };
