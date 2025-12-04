import { createPluginRuntime } from "every-plugin";

export type DiscourseRouter = {
  search: (input: Record<string, unknown>) => Promise<unknown>;
  getLatestTopics: (input: Record<string, unknown>) => Promise<unknown>;
  getTopic: (input: Record<string, unknown>) => Promise<unknown>;
  getPost: (input: Record<string, unknown>) => Promise<unknown>;
  getPostReplies: (input: Record<string, unknown>) => Promise<unknown>;
  getCategories: () => Promise<unknown>;
  getCategory: (input: Record<string, unknown>) => Promise<unknown>;
  getTags: () => Promise<unknown>;
};

export type DiscourseRouterFactory = () => Promise<DiscourseRouter>;

export const resolvePluginConfig = () => {
  const remoteUrl =
    process.env.DISCOURSE_PLUGIN_URL ||
    "https://jlwaugh-54-discourse-plugin-discourse-plugin-near-4c12399ef-ze.zephyrcloud.app/remoteEntry.js";
  const apiKey = process.env.DISCOURSE_API_KEY || "test-discourse-api-key";

  if (!process.env.DISCOURSE_PLUGIN_URL) {
    console.warn(
      "[discourse-plugin] Using baked-in remote entry; set DISCOURSE_PLUGIN_URL to override."
    );
  }

  return {
    remoteUrl,
    apiKey,
    variables: {
      discourseUrl: process.env.DISCOURSE_URL || "https://gov.near.org",
      discourseApiUsername: process.env.DISCOURSE_API_USERNAME || "gov",
      clientId: process.env.DISCOURSE_CLIENT_ID || "discourse-plugin",
    },
  };
};

export const runtimeRouterFactory: DiscourseRouterFactory = async () => {
  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV === "test" &&
    (globalThis as any).__mockDiscourseRouter
  ) {
    return (globalThis as any).__mockDiscourseRouter as DiscourseRouter;
  }

  const { remoteUrl, apiKey, variables } = resolvePluginConfig();

  const runtime = createPluginRuntime({
    registry: { "discourse-plugin": { remoteUrl } },
    secrets: { DISCOURSE_API_KEY: apiKey },
  });

  const { router } = await runtime.usePlugin("discourse-plugin", {
    variables,
    secrets: { discourseApiKey: "{{DISCOURSE_API_KEY}}" },
  });

  return router as unknown as DiscourseRouter;
};
