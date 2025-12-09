import { ORPCError } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DiscourseClient,
  DiscourseRouter,
} from "@/server/plugins/discourse";

declare global {
  var __mockDiscourseRouter: DiscourseRouter | undefined;
  var __mockDiscourseClient: DiscourseClient | undefined;
}

const originalNodeEnv = process.env.NODE_ENV;
const originalVitestEnv = process.env.VITEST;
const originalPluginUrl = process.env.DISCOURSE_PLUGIN_URL;
const originalApiKey = process.env.DISCOURSE_API_KEY;
const originalApiUsername = process.env.DISCOURSE_API_USERNAME;
const originalClientId = process.env.DISCOURSE_CLIENT_ID;
const originalDiscourseUrl = process.env.DISCOURSE_URL;

const setEnvVar = (key: string, value?: string) => {
  if (typeof value === "undefined") {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  Reflect.defineProperty(process.env, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
};

const restoreEnv = () => {
  setEnvVar("NODE_ENV", originalNodeEnv);
  setEnvVar("VITEST", originalVitestEnv);
  setEnvVar("DISCOURSE_PLUGIN_URL", originalPluginUrl);
  setEnvVar("DISCOURSE_API_KEY", originalApiKey);
  setEnvVar("DISCOURSE_API_USERNAME", originalApiUsername);
  setEnvVar("DISCOURSE_CLIENT_ID", originalClientId);
  setEnvVar("DISCOURSE_URL", originalDiscourseUrl);
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.resetModules();
  delete global.__mockDiscourseRouter;
  delete global.__mockDiscourseClient;
  restoreEnv();
});

describe("discourse plugin wiring", () => {
  it("uses fallback router/client when running inside Vitest", async () => {
    vi.resetModules();
    setEnvVar("VITEST", "1");
    setEnvVar("NODE_ENV", "test");
    delete global.__mockDiscourseRouter;
    delete global.__mockDiscourseClient;

    const { discourseRouter, discourseClient } = await import(
      "@/server/plugins/discourse"
    );

    await expect(discourseRouter.getLatestTopics()).resolves.toEqual({
      topics: [],
      hasMore: false,
    });

    await expect(
      discourseClient.search({ query: "fallback" })
    ).resolves.toEqual({ error: "discourse-mock" });
  });

  it("honors global mock router and client overrides in tests", async () => {
    vi.resetModules();
    setEnvVar("VITEST", "1");
    setEnvVar("NODE_ENV", "test");

    const routerMock: DiscourseRouter = {
      initiateLink: vi.fn(async () => ({
        authUrl: "x",
        nonce: "n1",
        expiresAt: "later",
      })),
      completeLink: vi.fn(async () => null),
      authRoutes: {
        initiateLink: vi.fn(async () => ({
          authUrl: "x",
          nonce: "n1",
          expiresAt: "later",
        })),
        completeLink: vi.fn(async () => null),
      },
      getLinkage: vi.fn(async () => null),
      ping: vi.fn(async () => "pong"),
      createPost: vi.fn(async () => null),
      getLatestTopics: vi.fn(async () => ({ topics: [], hasMore: false })),
      getTopic: vi.fn(async () => null),
      getPost: vi.fn(async () => null),
      getPostReplies: vi.fn(async () => ({ post: null, replies: [] })),
      getCategories: vi.fn(async () => ({ categories: [] })),
      getCategory: vi.fn(async () => ({ category: null, subcategories: [] })),
      getTags: vi.fn(async () => ({ tags: [] })),
      search: vi.fn(async () => ({
        posts: [],
        topics: [],
        users: [],
        categories: [],
        totalResults: 0,
      })),
      linkageStore: {
        unlink: vi.fn(async () => null),
      },
    };

    const clientMock: DiscourseClient = {
      search: vi.fn(async () => ({ error: "mock-client" })),
      getLatestTopics: vi.fn(async () => ({ topics: [], hasMore: false })),
      getTopic: vi.fn(async () => null),
      getPost: vi.fn(async () => null),
      getPostReplies: vi.fn(async () => ({ post: null, replies: [] })),
      getCategories: vi.fn(async () => ({ categories: [] })),
      getCategory: vi.fn(async () => ({ category: null, subcategories: [] })),
      getTags: vi.fn(async () => ({ tags: [] })),
    };

    global.__mockDiscourseRouter = routerMock;
    global.__mockDiscourseClient = clientMock;

    const { discourseRouter, discourseClient } = await import(
      "@/server/plugins/discourse"
    );

    expect(discourseRouter).toBe(routerMock);
    await discourseRouter.ping();
    expect(routerMock.ping).toHaveBeenCalled();

    expect(discourseClient).toBe(clientMock);
    await discourseClient.search({ query: "mocked" });
    expect(clientMock.search).toHaveBeenCalled();
  });
});

describe("production plugin runtime initialization", () => {
  it("creates a runtime with normalized remote entry and configured secrets", async () => {
    vi.resetModules();
    setEnvVar("NODE_ENV", "production");
    setEnvVar("VITEST");
    setEnvVar("DISCOURSE_PLUGIN_URL", "http://example.com");
    setEnvVar("DISCOURSE_API_KEY", "prod-key");
    setEnvVar("DISCOURSE_API_USERNAME", "api-user");
    setEnvVar("DISCOURSE_CLIENT_ID", "custom-client");

    const baseUrl = "https://gov.test";
    setEnvVar("DISCOURSE_URL", baseUrl);

    const pluginRouter: DiscourseRouter = {
      initiateLink: vi.fn(async () => null),
      completeLink: vi.fn(async () => null),
      authRoutes: {
        initiateLink: vi.fn(async () => null),
        completeLink: vi.fn(async () => null),
      },
      getLinkage: vi.fn(async () => null),
      ping: vi.fn(async () => "pong"),
      createPost: vi.fn(async () => null),
      getLatestTopics: vi.fn(async () => ({ topics: [], hasMore: false })),
      getTopic: vi.fn(async () => null),
      getPost: vi.fn(async () => null),
      getPostReplies: vi.fn(async () => ({ post: null, replies: [] })),
      getCategories: vi.fn(async () => ({ categories: [] })),
      getCategory: vi.fn(async () => ({ category: null, subcategories: [] })),
      getTags: vi.fn(async () => ({ tags: [] })),
      search: vi.fn(async () => ({
        posts: [],
        topics: [],
        users: [],
        categories: [],
        totalResults: 0,
      })),
      linkageStore: {
        unlink: vi.fn(async () => null),
      },
    };

    const pluginClient: DiscourseClient = {
      search: vi.fn(async () => ({
        posts: [],
        topics: [],
        users: [],
        categories: [],
        totalResults: 0,
      })),
      getLatestTopics: vi.fn(async () => ({ topics: [], hasMore: false })),
      getTopic: vi.fn(async () => null),
      getPost: vi.fn(async () => null),
      getPostReplies: vi.fn(async () => ({ post: null, replies: [] })),
      getCategories: vi.fn(async () => ({ categories: [] })),
      getCategory: vi.fn(async () => ({ category: null, subcategories: [] })),
      getTags: vi.fn(async () => ({ tags: [] })),
    };

    const runtime = {
      usePlugin: vi.fn(async () => ({
        router: pluginRouter,
        client: pluginClient,
      })),
      shutdown: vi.fn(async () => undefined),
    };

    const createPluginRuntimeMock = vi.fn(() => runtime);

    vi.doMock("every-plugin", () => ({
      createPluginRuntime: createPluginRuntimeMock,
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { discourseRouter, discourseClient } = await import(
        "@/server/plugins/discourse"
      );

      expect(createPluginRuntimeMock).toHaveBeenCalledWith({
        registry: {
          "discourse-plugin": {
            remoteUrl: "http://example.com/remoteEntry.js",
          },
        },
        secrets: { DISCOURSE_API_KEY: "prod-key" },
      });
      expect(runtime.usePlugin).toHaveBeenCalledWith("discourse-plugin", {
        variables: {
          discourseBaseUrl: baseUrl,
          discourseApiUsername: "api-user",
          clientId: "custom-client",
        },
        secrets: { discourseApiKey: "{{DISCOURSE_API_KEY}}" },
      });
      expect(discourseRouter).toBe(pluginRouter);
      expect(discourseClient).toBe(pluginClient);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      vi.doUnmock("every-plugin");
    }
  });
});

describe("discourse client wrapper helpers", () => {
  const validSearchResponse = {
    posts: [],
    topics: [],
    users: [],
    categories: [],
    totalResults: 0,
    hasMore: false,
    nextPage: null,
  };

  const createClientStub = (
    searchImpl: (input: unknown) => Promise<unknown>
  ) => {
    const searchMock = vi.fn(searchImpl);
    return {
      client: {
        search: searchMock,
        getLatestTopics: vi.fn(async () => ({ topics: [], hasMore: false })),
        getTopic: vi.fn(async () => null),
        getPost: vi.fn(async () => null),
        getPostReplies: vi.fn(async () => ({ post: null, replies: [] })),
        getCategories: vi.fn(async () => ({ categories: [] })),
        getCategory: vi.fn(async () => ({ category: null, subcategories: [] })),
        getTags: vi.fn(async () => ({ tags: [] })),
      } as unknown as DiscourseClient,
      searchMock,
    };
  };

  it("returns friendly feedback for rate-limited responses", async () => {
    const { createDiscourseClientWrapper } = await import(
      "@/server/plugins/discourse-client"
    );

    const { client, searchMock } = createClientStub(async () => {
      throw new ORPCError("RATE_LIMITED", { message: "Slow down" });
    });

    const factory = vi.fn(async () => client);
    const wrapper = createDiscourseClientWrapper(factory);

    await expect(wrapper.search({ query: "ratelimit" })).resolves.toEqual({
      error: "Too many requests—please try again shortly.",
      status: 429,
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalled();
  });

  it("surfaces validation failures for malformed API payloads", async () => {
    const { createDiscourseClientWrapper } = await import(
      "@/server/plugins/discourse-client"
    );

    const { client } = createClientStub(async () => ({}));
    const wrapper = createDiscourseClientWrapper(async () => client);

    await expect(wrapper.search({ query: "broken" })).resolves.toEqual({
      error: "Invalid search response",
      status: 400,
    });
  });

  it("refreshes the client factory after a failed initialization", async () => {
    const { createDiscourseClientWrapper } = await import(
      "@/server/plugins/discourse-client"
    );

    const { client, searchMock } = createClientStub(
      async () => validSearchResponse
    );
    const factory = vi.fn();
    factory.mockRejectedValueOnce(new Error("token expired"));
    factory.mockResolvedValueOnce(client);

    const wrapper = createDiscourseClientWrapper(factory);

    await expect(wrapper.search({ query: "first" })).resolves.toEqual({
      error: "Unexpected error—please try again.",
    });
    await expect(wrapper.search({ query: "second" })).resolves.toEqual({
      data: validSearchResponse,
    });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(searchMock).toHaveBeenCalledTimes(1);
  });
});
