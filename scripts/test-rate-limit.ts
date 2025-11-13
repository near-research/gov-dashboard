/**
 * Utility script for exercising rate limiting across the proposal-screening
 * and summarization endpoints. It can run against a single endpoint or iterate
 * through all of them, sending multiple requests in quick succession and
 * logging the rate-limit headers so you can confirm each limiter behaves as
 * expected.
 *
 * Usage:
 *   # Default (evaluateDraft)
 *   bun run src/lib/scripts/test-rate-limit.ts
 *
 *   # Specific endpoint
 *   bun run src/lib/scripts/test-rate-limit.ts proposalSummary http://localhost:3000 <topicId> 6 200
 *
 *   # All endpoints sequentially
 *   bun run src/lib/scripts/test-rate-limit.ts all http://localhost:3000 topicId replyId postId 6 200
 *
 * Endpoint-specific requirements:
 *   - screen: requires NEAR_AUTH_TOKEN (Bearer token)
 *   - proposalSummary: topic ID
 *   - proposalRevisions: topic ID
 *   - discussionSummary: topic ID
 *   - replySummary: reply/post ID
 *   - postRevisions: post ID
 *
 * Environment variables:
 *   NEAR_AUTH_TOKEN - optional Bearer token. Required for /api/screen, optional for /api/evaluateDraft.
 *   RATE_LIMIT_BASE_URL - optional default base URL (falls back to http://localhost:3000).
 */

import { setTimeout as wait } from "timers/promises";

type SingleEndpoint =
  | "evaluateDraft"
  | "screen"
  | "proposalSummary"
  | "proposalRevisions"
  | "discussionSummary"
  | "replySummary"
  | "postRevisions";

type EndpointArg = SingleEndpoint | "all";
const PLACEHOLDER_TOPIC_ID = "placeholder-topic";
const PLACEHOLDER_REPLY_ID = "placeholder-reply";
const PLACEHOLDER_POST_ID = "placeholder-post";

interface BaseConfig {
  baseUrl: string;
  attempts: number;
  delayMs: number;
}

interface SingleEndpointConfig extends BaseConfig {
  mode: "single";
  endpoint: SingleEndpoint;
  resourceId?: string;
}

interface AllEndpointConfig extends BaseConfig {
  mode: "all";
  ids: {
    topicId?: string;
    replyId?: string;
    postId?: string;
  };
}

type TestConfig = SingleEndpointConfig | AllEndpointConfig;

const endpointMeta: Record<
  SingleEndpoint,
  {
    path: (resourceId?: string) => string;
    requiresId: boolean;
    requiresAuth?: boolean;
    idLabel?: string;
  }
> = {
  evaluateDraft: {
    path: () => "/api/evaluateDraft",
    requiresId: false,
  },
  screen: {
    path: () => "/api/screen",
    requiresId: false,
    requiresAuth: true,
  },
  proposalSummary: {
    path: (id) => `/api/proposals/${id}/summarize`,
    requiresId: true,
    idLabel: "topicId",
  },
  proposalRevisions: {
    path: (id) => `/api/proposals/${id}/revisions/summarize`,
    requiresId: true,
    idLabel: "topicId",
  },
  discussionSummary: {
    path: (id) => `/api/discourse/topics/${id}/summarize`,
    requiresId: true,
    idLabel: "topicId",
  },
  replySummary: {
    path: (id) => `/api/discourse/replies/${id}/summarize`,
    requiresId: true,
    idLabel: "replyId",
  },
  postRevisions: {
    path: (id) => `/api/discourse/posts/${id}/revisions/summarize`,
    requiresId: true,
    idLabel: "postId",
  },
};

function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  const endpointArg = (args[0] as EndpointArg | undefined) || "evaluateDraft";

  if (endpointArg !== "all" && !endpointMeta[endpointArg]) {
    console.error(
      `Invalid endpoint "${endpointArg}". Choose one of: ${[
        "all",
        ...Object.keys(endpointMeta),
      ].join(", ")}`
    );
    process.exit(1);
  }

  const baseUrl =
    args[1] || process.env.RATE_LIMIT_BASE_URL || "http://localhost:3000";

  let attemptsArg: string | undefined;
  let delayArg: string | undefined;

  if (endpointArg === "all") {
    let topicId = args[2];
    let replyId = args[3];
    let postId = args[4];
    attemptsArg = args[5];
    delayArg = args[6];

    if (!topicId || !replyId || !postId) {
      console.warn(
        "All-mode: topicId, replyId, or postId not provided. Using placeholder IDs that will likely trigger 4xx responses."
      );
      topicId = topicId || PLACEHOLDER_TOPIC_ID;
      replyId = replyId || PLACEHOLDER_REPLY_ID;
      postId = postId || PLACEHOLDER_POST_ID;
    }

    return {
      mode: "all",
      baseUrl,
      ids: { topicId, replyId, postId },
      attempts: parseAttempts(attemptsArg),
      delayMs: parseDelay(delayArg),
    };
  }

  const thirdArg = args[2];
  const fourthArg = args[3];
  const fifthArg = args[4];

  let resourceId: string | undefined;

  if (thirdArg && isNaN(Number(thirdArg))) {
    resourceId = thirdArg;
    attemptsArg = fourthArg;
    delayArg = fifthArg;
  } else {
    attemptsArg = thirdArg;
    delayArg = fourthArg;
  }

  if (endpointMeta[endpointArg].requiresId && !resourceId) {
    const label = endpointMeta[endpointArg].idLabel || "resource ID";
    console.warn(
      `Endpoint "${endpointArg}" missing ${label}. Using placeholder value; expect 4xx responses.`
    );
    resourceId = getPlaceholderId(label);
  }

  return {
    mode: "single",
    endpoint: endpointArg,
    baseUrl,
    resourceId,
    attempts: parseAttempts(attemptsArg),
    delayMs: parseDelay(delayArg),
  };
}

function parseAttempts(arg?: string): number {
  const attempts = arg ? Number.parseInt(arg, 10) : 6;
  if (Number.isNaN(attempts) || attempts < 1) {
    console.error("Attempts must be a positive integer.");
    process.exit(1);
  }
  return attempts;
}

function parseDelay(arg?: string): number {
  const delayMs = arg ? Number.parseInt(arg, 10) : 200;
  if (Number.isNaN(delayMs) || delayMs < 0) {
    console.error("Delay must be a non-negative integer (milliseconds).");
    process.exit(1);
  }
  return delayMs;
}

function getPlaceholderId(label: string): string {
  switch (label) {
    case "topicId":
      return PLACEHOLDER_TOPIC_ID;
    case "replyId":
      return PLACEHOLDER_REPLY_ID;
    case "postId":
      return PLACEHOLDER_POST_ID;
    default:
      return `placeholder-${label}`;
  }
}

function buildPayload(endpoint: SingleEndpoint) {
  const title = `Rate limit test (${new Date().toISOString()})`;
  const text =
    "Automated rate-limit verification request. Safe to discard this payload.";

  if (endpoint === "screen") {
    return { title, proposal: text };
  }

  if (endpoint === "evaluateDraft") {
    return { title, content: text };
  }

  // Summarization endpoints do not require a body
  return {};
}

async function runEndpoint(
  endpoint: SingleEndpoint,
  baseUrl: string,
  resourceId: string | undefined,
  attempts: number,
  delayMs: number
) {
  const meta = endpointMeta[endpoint];
  const path = meta.path(resourceId);
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authToken = process.env.NEAR_AUTH_TOKEN;
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  console.log(
    `\n=== Testing ${endpoint} @ ${url} (${attempts} attempts, ${delayMs}ms apart) ===`
  );
  if (meta.requiresAuth && !authToken) {
    console.warn(
      "Warning: this endpoint requires a NEAR auth token. Set NEAR_AUTH_TOKEN to continue."
    );
  }

  const payload = buildPayload(endpoint);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const rawBody = await response.text();
      let parsedBody: unknown = rawBody;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        // keep raw body
      }

      const remaining = response.headers.get("X-RateLimit-Remaining");
      const retryAfter = response.headers.get("Retry-After");
      const resetHeader = response.headers.get("X-RateLimit-Reset");

      console.log(
        `Attempt ${attempt}: ${response.status} ${
          response.statusText
        } | remaining=${remaining ?? "n/a"} | reset=${
          resetHeader ?? "n/a"
        }s | retryAfter=${retryAfter ?? "n/a"}`
      );

      if (response.status >= 400) {
        console.log("  Response body:", parsedBody);
      }
    } catch (error) {
      console.error(`Attempt ${attempt} failed`, error);
    }

    if (attempt < attempts && delayMs > 0) {
      await wait(delayMs);
    }
  }
}

async function run() {
  const config = parseArgs();

  if (config.mode === "all") {
    const { topicId, replyId, postId } = config.ids;
    if (!topicId || !replyId || !postId) {
      throw new Error("Missing topicId/replyId/postId for 'all' run.");
    }

    await runEndpoint("evaluateDraft", config.baseUrl, undefined, config.attempts, config.delayMs);
    await runEndpoint("screen", config.baseUrl, undefined, config.attempts, config.delayMs);
    await runEndpoint("proposalSummary", config.baseUrl, topicId, config.attempts, config.delayMs);
    await runEndpoint("proposalRevisions", config.baseUrl, topicId, config.attempts, config.delayMs);
    await runEndpoint("discussionSummary", config.baseUrl, topicId, config.attempts, config.delayMs);
    await runEndpoint("replySummary", config.baseUrl, replyId, config.attempts, config.delayMs);
    await runEndpoint("postRevisions", config.baseUrl, postId, config.attempts, config.delayMs);
    return;
  }

  await runEndpoint(
    config.endpoint,
    config.baseUrl,
    config.resourceId,
    config.attempts,
    config.delayMs
  );
}

run().catch((error) => {
  console.error("Rate limit test encountered an error:", error);
  process.exit(1);
});
