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
    const slashIndex = withoutScheme.indexOf("/");
    const host = slashIndex === -1 ? withoutScheme : withoutScheme.slice(0, slashIndex);
    const remainder =
      slashIndex === -1 ? "" : withoutScheme.slice(slashIndex);
    const normalizedRemainder = remainder || "/";
    const path =
      host && host.toLowerCase() !== "localhost"
        ? `/${host}${normalizedRemainder}`
        : normalizedRemainder;
    return `file://${path}`;
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

const isDiscourseRequestLoggingEnabled = truthyEnv(
  process.env.DISCOURSE_LOG_REQUESTS
);

const isTestEnvironment =
  Boolean(process.env.VITEST) ||
  process.env.NODE_ENV === "test" ||
  truthyEnv(process.env.PLAYWRIGHT_TEST);

const DISCOURSE_FETCH_PATCH_FLAG = Symbol.for("gov.discourse.fetchPatch");
type GlobalWithDiscourseFetchPatch = typeof globalThis & {
  [DISCOURSE_FETCH_PATCH_FLAG]?: boolean;
};

const parseRequestUrl = (rawUrl: string, fallbackBase: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    try {
      return new URL(rawUrl, fallbackBase);
    } catch {
      return null;
    }
  }
};

const patchDiscourseFetch = () => {
  if (isTestEnvironment) {
    return;
  }

  const requestCtor = globalThis.Request;
  if (typeof requestCtor !== "function") {
    logger.warn(
      "[discourse-plugin] Request ctor is unavailable; skipping request instrumentation."
    );
    return;
  }

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") {
    logger.warn(
      "[discourse-plugin] fetch is unavailable in this runtime; skipping request instrumentation."
    );
    return;
  }

  const globalCandidate = globalThis as GlobalWithDiscourseFetchPatch;
  if (globalCandidate[DISCOURSE_FETCH_PATCH_FLAG]) {
    return;
  }

  const normalizedBase = getDiscourseBaseUrl().replace(/\/$/, "");
  const normalizedBaseLower = normalizedBase.toLowerCase();
  const boundFetch = originalFetch.bind(globalThis as unknown as object);

  globalCandidate[DISCOURSE_FETCH_PATCH_FLAG] = true;

  const instrumentedFetch = async (
    ...args: Parameters<typeof originalFetch>
  ) => {
    const [input, init] = args;
    let request: Request;
    try {
      request = new requestCtor(input, init);
    } catch {
      return boundFetch(input, init);
    }

    const method = request.method.toUpperCase();
    const urlLower = request.url.toLowerCase();
    const parsedUrl = parseRequestUrl(request.url, normalizedBase);
    const pathname = parsedUrl?.pathname.toLowerCase() ?? null;
    const isDiscourseRequest = urlLower.startsWith(normalizedBaseLower);
    const isCreatePostRequest =
      method === "POST" && isDiscourseRequest && pathname === "/posts.json";
    const shouldLog =
      isDiscourseRequestLoggingEnabled &&
      method === "POST" &&
      isDiscourseRequest;

    let cachedBodyText: string | undefined;
    let bodyReadErrorMessage: string | undefined;
    const captureBodyText = async () => {
      if (cachedBodyText !== undefined || bodyReadErrorMessage !== undefined) {
        return;
      }
      try {
        cachedBodyText = await request.clone().text();
      } catch (error) {
        bodyReadErrorMessage =
          error instanceof Error
            ? `unable to read body: ${error.message}`
            : "unable to read body";
      }
    };

    if (shouldLog || isCreatePostRequest) {
      await captureBodyText();
    }

    if (isCreatePostRequest) {
      const apiKey = process.env.DISCOURSE_API_KEY;
      if (!apiKey) {
        throw new Error(
          "DISCOURSE_API_KEY is not set. Please configure a system admin key in the environment."
        );
      }
      request.headers.set("Api-Key", apiKey);
      const rawBody =
        typeof cachedBodyText === "string" && cachedBodyText.length
          ? cachedBodyText
          : undefined;
      let parsedBody: unknown;
      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = undefined;
        }
      }
      const payloadUsername =
        parsedBody &&
        typeof parsedBody === "object" &&
        parsedBody !== null &&
        typeof (parsedBody as Record<string, unknown>).username === "string"
          ? (parsedBody as Record<string, unknown>).username
          : undefined;
      const fallbackUsername =
        process.env.DISCOURSE_API_USERNAME ||
        process.env.DISCOURSE_API_USER ||
        remoteDefaults.apiUsername;
      const computedUsername =
        request.headers.get("Api-Username") ??
        payloadUsername ??
        fallbackUsername;
      if (typeof computedUsername === "string" && computedUsername.length > 0) {
        request.headers.set("Api-Username", computedUsername);
      }
      const username = request.headers.get("Api-Username");
      logger.debug("[discourse.createPost] Using system API key", {
        keyPrefix: apiKey.slice(0, 4),
        keyLength: apiKey.length,
        username,
      });
      const parsedBodyForLog = parsedBody ?? rawBody;
      const loggedHeaders = {
        apiKeyPrefix: request.headers.get("Api-Key")?.slice(0, 4),
        apiUsername: request.headers.get("Api-Username"),
        contentType: request.headers.get("Content-Type"),
      };
      console.debug("[discourse.createPost] Final request", {
        url: request.url,
        method: request.method,
        headers: loggedHeaders,
        body: parsedBodyForLog,
      });
    }

    if (shouldLog) {
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const bodyForLog = cachedBodyText ?? bodyReadErrorMessage ?? "";
      const truncatedBody =
        bodyForLog.length > 2000 ? `${bodyForLog.slice(0, 2000)}…` : bodyForLog;
      logger.info("[discourse] outgoing request", {
        method: request.method,
        url: request.url,
        headers,
        body: truncatedBody,
      });
    }

    const response = await boundFetch(request);

    if (isCreatePostRequest && !response.ok) {
      const responseText = await response.clone().text();
      if (response.status === 403) {
        throw new Error(`Discourse invalid_access: ${responseText}`);
      }
      throw new Error(
        `Discourse createPost failed: ${response.status} ${response.statusText} – ${responseText}`
      );
    }

    return response;
  };

  globalThis.fetch = instrumentedFetch;
};

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
    "https://jlwaugh-72-discourse-plugin-discourse-plugin-near-c1edf58b4-ze.zephyrcloud.app/remoteEntry.js";
  const normalizedRemoteEntryUrl = normalizeRemoteEntryUrl(remoteEntryUrl);

  if (!process.env.DISCOURSE_PLUGIN_URL) {
    logger.warn(
      "[discourse-plugin] Using baked-in remote entry; set DISCOURSE_PLUGIN_URL to override."
    );
  }

  patchDiscourseFetch();
  logger.info("[discourse-plugin] runtime configuration", {
    baseUrl: remoteDefaults.baseUrl,
    apiUsername: remoteDefaults.apiUsername,
    clientId: remoteDefaults.clientId,
    usingCustomPluginUrl: Boolean(process.env.DISCOURSE_PLUGIN_URL),
    loggingOutgoingRequests: isDiscourseRequestLoggingEnabled,
  });

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

  discourseRouter = plugin.router;
  discourseClient = plugin.client;
}

export { getDiscourseBaseUrl };
export { discourseRouter, discourseClient };
