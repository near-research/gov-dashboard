import { randomBytes } from "crypto";
import type { Page, Route } from "@playwright/test";
import type { AGUIEvent } from "@/types/agui-events";
import { EventType } from "@/types/agui-events";
import proposalsFixture from "../../fixtures/playwright/proposals-latest.json";
import screeningFixture from "../../fixtures/playwright/screening-response.json";
import topicSummaryFixture from "../../fixtures/playwright/discourse-topic-summary.json";
import replySummaryFixture from "../../fixtures/playwright/discourse-reply-summary.json";
import proposalDetailFixture from "../../fixtures/playwright/proposal-detail.json";
import proposalRevisionsFixture from "../../fixtures/playwright/proposal-revisions.json";
import revisionSummaryFixture from "../../fixtures/playwright/proposal-revision-summary.json";
import revisionAnalysesFixture from "../../fixtures/playwright/revision-analyses.json";

const shouldLogMocks = (process.env.PLAYWRIGHT_TEST ?? "").trim().toLowerCase() === "true";
type PageWithAuthOverride = Page & {
  __hasCustomAuthRoutes__?: boolean;
  __hasCustomChatCompletionRoute__?: boolean;
};

export const markPageWithCustomAuthRoutes = (page: Page) => {
  (page as PageWithAuthOverride).__hasCustomAuthRoutes__ = true;
};
export async function mockProposalRevisions(page: Page, proposalId: number | string) {
  await page.route(`**/api/proposals/${proposalId}/revisions`, (route) => {
    logRouteHit("api/proposals/:id/revisions (mock helper)", route);
    if (route.request().method() === "GET") {
      const payload = {
        ...proposalRevisionsFixture,
        post_id: Number.isFinite(Number(proposalId))
          ? Number(proposalId)
          : proposalRevisionsFixture.post_id,
      };
      respondWithJson(route, payload);
      return;
    }
    route.continue();
  });
}
const logRouteHit = (label: string, route: Route) => {
  if (!shouldLogMocks) return;
  const request = route.request();
  console.debug(`[playwright mock] ${label} ${request.method()} ${request.url()}`);
};

const apiRoute = (path: string) => `**${path}`;

const respondWithJson = (route: Route, payload: unknown) => {
  route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

const createSsePayload = (events: unknown[]) =>
  `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;

const defaultChatCompletionChunks = [
  {
    choices: [
      {
        delta: {
          role: "assistant",
          content: "NEAR AI assistant says hello from the mocked stream.",
        },
        index: 0,
        finish_reason: null,
      },
    ],
  },
  {
    choices: [
      {
        delta: {
          role: "assistant",
          content: "Here is a quick plan for governance updates.",
        },
        index: 0,
        finish_reason: null,
      },
    ],
  },
  {
    choices: [
      {
        delta: {
          role: "assistant",
          content: "Final thought from NEAR AI.",
        },
        index: 0,
        finish_reason: "stop",
      },
    ],
  },
];

type VerificationSessionData = {
  nonce: string;
  requestHash: string | null;
  responseHash: string | null;
  createdAt: number;
  expiresAt: number;
};

const SESSION_TTL_MS = 5 * 60 * 1000;
const verificationSessions = new Map<string, VerificationSessionData>();

const normalizeVerificationSession = (
  verificationId: string,
  overrides?: {
    nonce?: string;
    requestHash?: string | null;
    responseHash?: string | null;
  }
) => {
  const now = Date.now();
  const existing = verificationSessions.get(verificationId);
  if (existing && now < existing.expiresAt) {
    const nonce = overrides?.nonce ?? existing.nonce;
    const session: VerificationSessionData = {
      nonce,
      requestHash: overrides?.requestHash ?? existing.requestHash,
      responseHash: overrides?.responseHash ?? existing.responseHash,
      createdAt: existing.createdAt,
      expiresAt: now + SESSION_TTL_MS,
    };
    verificationSessions.set(verificationId, session);
    return session;
  }

  const nonce =
    overrides?.nonce && /^[0-9a-f]{64}$/i.test(overrides.nonce)
      ? overrides.nonce
      : randomBytes(32).toString("hex");
  const session: VerificationSessionData = {
    nonce,
    requestHash: overrides?.requestHash ?? null,
    responseHash: overrides?.responseHash ?? null,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  verificationSessions.set(verificationId, session);
  return session;
};

const parseJsonBody = (route: Route) => {
  const raw = route.request().postData();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

export const registerMockVerificationSession = (
  verificationId: string,
  data?: {
    nonce?: string;
    requestHash?: string | null;
    responseHash?: string | null;
  }
) => {
  if (!verificationId) return null;
  return normalizeVerificationSession(verificationId, data);
};

export const registerMockVerificationSessionsForEvents = (
  events: Array<AGUIEvent & { proof?: Record<string, unknown> }>
) => {
  if (!Array.isArray(events)) return;
  events.forEach((event) => {
    if (!event || typeof event !== "object") return;
    const proof = (event as any).proof;
    if (!proof || typeof proof !== "object") return;
    const verificationId = typeof proof.verificationId === "string" ? proof.verificationId : "";
    if (!verificationId) return;
    registerMockVerificationSession(verificationId, {
      nonce: typeof proof.nonce === "string" ? proof.nonce : undefined,
      requestHash:
        typeof proof.requestHash === "string" ? proof.requestHash : null,
      responseHash:
        typeof proof.responseHash === "string" ? proof.responseHash : null,
    });
  });
};

export const registerPlaywrightMocks = (
  page: Page,
  options?: { skipChatCompletionsStream?: boolean }
) => {
  verificationSessions.clear();
  const pageWithAuthOverride = page as PageWithAuthOverride;

  page.route(/\/api\/auth(\/.*)?$/, async (route) => {
    if (pageWithAuthOverride.__hasCustomAuthRoutes__) {
      await route.continue();
      return;
    }

    logRouteHit("api/auth", route);
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      if (url.pathname.endsWith("/csrf")) {
        respondWithJson(route, { csrfToken: "mock-csrf" });
        return;
      }
      if (url.pathname.endsWith("/session")) {
        respondWithJson(route, { user: null, session: null });
        return;
      }
      if (url.pathname.endsWith("/accounts")) {
        respondWithJson(route, { data: [] });
        return;
      }
      respondWithJson(route, {});
      return;
    }

    respondWithJson(route, { ok: true });
  });

  page.route(/\/api\/discourse\/latest/, (route) => {
    logRouteHit("api/discourse/latest", route);
    respondWithJson(route, proposalsFixture);
  });

  const proposalId = String(proposalDetailFixture.topic_id ?? 42);
  const proposalSummaryFixture = {
    success: true,
    summary:
      "Mock proposal summary describing the objectives and measurable KPIs for the NEAR Governance flow.",
    model: "mock/proposal-summary",
    proposalId,
    title: proposalDetailFixture.title,
    author: proposalDetailFixture.username,
    createdAt: proposalDetailFixture.created_at,
    truncated: false,
    generatedAt: Date.now(),
    cached: false,
    viewCount: proposalDetailFixture.views,
    replyCount: proposalDetailFixture.reply_count,
    likeCount: proposalDetailFixture.like_count,
  };
  page.route(new RegExp(`/api/proposals/${proposalId}(?:\\?.*)?$`), (route) => {
    logRouteHit("api/proposals/:id", route);
    if (route.request().method() === "GET") {
      respondWithJson(route, proposalDetailFixture);
      return;
    }
    route.continue();
  });

  page.route(new RegExp(`/api/proposals/${proposalId}/revisions$`), (route) => {
    logRouteHit("api/proposals/:id/revisions", route);
    if (route.request().method() === "GET") {
      respondWithJson(route, proposalRevisionsFixture);
      return;
    }
    route.continue();
  });

  page.route(new RegExp(`/api/proposals/${proposalId}/revisions/summarize$`), (route) => {
    logRouteHit("api/proposals/:id/revisions/summarize", route);
    if (route.request().method() === "POST") {
      respondWithJson(route, revisionSummaryFixture);
      return;
    }
    route.continue();
  });

  page.route(new RegExp(`/api/proposals/${proposalId}/summarize$`), (route) => {
    logRouteHit("api/proposals/:id/summarize", route);
    if (route.request().method() === "POST") {
      respondWithJson(route, proposalSummaryFixture);
      return;
    }
    route.continue();
  });

  page.route(/\/api\/getAnalysis\/\d+/, (route) => {
    logRouteHit("api/getAnalysis", route);
    const url = new URL(route.request().url());
    const revisionParam = url.searchParams.get("revisionNumber");
    const key = revisionParam || "latest";
    const screenings =
      revisionAnalysesFixture.screenings as Record<
        string,
        typeof revisionAnalysesFixture.screenings.latest
      >;
    const payload = screenings[key] ?? revisionAnalysesFixture.screenings.latest;
    if (payload) {
      respondWithJson(route, {
        topicId: revisionAnalysesFixture.topicId,
        results: [payload],
        screenings: [payload],
        hasMore: false,
      });
      return;
    }
    route.fulfill({
      status: 404,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Mock screening not found",
      }),
    });
  });

  page.route(apiRoute("/api/screen"), (route) => {
    logRouteHit("api/screen", route);
    respondWithJson(route, screeningFixture);
  });

  page.route(/\/api\/discourse\/topics\/\d+$/, (route) => {
    logRouteHit("api/discourse/topics/:id", route);
    const topicRevisions = [
      { version: 1, created_at: "2024-01-01T00:00:00Z" },
      { version: 2, created_at: "2024-01-02T00:00:00Z" },
      { version: 3, created_at: "2024-01-03T00:00:00Z" },
    ];
    const topicId = proposalDetailFixture.topic_id ?? 42;
    const topicSlug = proposalDetailFixture.topic_slug ?? "test-proposal";
    const topicUrl = `https://gov.near.org/t/${topicSlug}/${topicId}`;
    const currentTopicRevision = 3;
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: topicId,
        title: proposalDetailFixture.title,
        slug: topicSlug,
        url: topicUrl,
        current_revision: currentTopicRevision,
        post_stream: {
          posts: [
            {
              id: 1,
              version: currentTopicRevision,
              revisions: currentTopicRevision,
              cooked: "<p>v3 content</p>",
              username: proposalDetailFixture.username,
              created_at: "2024-01-03T00:00:00Z",
            },
          ],
        },
        revisions: topicRevisions,
      }),
    });
  });

  page.route(/\/api\/discourse\/topics\/\d+\/summarize/, (route) => {
    logRouteHit("api/discourse/topics/:id/summarize", route);
    respondWithJson(route, topicSummaryFixture);
  });

  page.route(/\/api\/discourse\/replies\/\d+\/summarize/, (route) => {
    logRouteHit("api/discourse/replies/:id/summarize", route);
    respondWithJson(route, replySummaryFixture);
  });

  const skipChatCompletionsStream =
    options?.skipChatCompletionsStream ||
    Boolean(pageWithAuthOverride.__hasCustomChatCompletionRoute__);

  if (!skipChatCompletionsStream) {
    page.route(apiRoute("/api/chat/completions"), (route) => {
      logRouteHit("api/chat/completions", route);
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        body: createSsePayload(defaultChatCompletionChunks),
      });
    });
  }

  const buildDefaultAgentEvents = (): AGUIEvent[] => {
    const now = Date.now();
    const messageId = `mock-agent-${now}`;
    const runId = `run-${now}`;
    const threadId = `thread-${now}`;

    return [
      {
        type: EventType.RUN_STARTED,
        threadId,
        runId,
        timestamp: now,
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
        timestamp: now + 1,
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: "NEAR AI assistant says hello from the mocked stream.",
        timestamp: now + 2,
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: "Here is a quick plan for governance updates.",
        timestamp: now + 3,
      },
      {
        type: EventType.STATE_DELTA,
        delta: [
          { op: "replace", path: "/title", value: "AI-augmented title" },
          {
            op: "replace",
            path: "/content",
            value: "Agent suggested content with KPIs and a clearer objective.",
          },
        ],
        timestamp: now + 4,
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: "Final thought from NEAR AI.",
        timestamp: now + 5,
      },
      {
        type: EventType.TEXT_MESSAGE_END,
        messageId,
        timestamp: now + 6,
      },
      {
        type: EventType.RUN_FINISHED,
        threadId,
        runId,
        timestamp: now + 7,
      },
    ];
  };

  page.route(apiRoute("/api/agent"), (route) => {
    logRouteHit("api/agent", route);
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: createSsePayload(buildDefaultAgentEvents()),
    });
  });

  page.route(apiRoute("/api/verification/proof"), (route) => {
    logRouteHit("api/verification/proof", route);
    respondWithJson(route, {
      signature: { text: "mock-signature" },
      results: {
        verified: true,
        reasons: ["Mock verification returned success"],
      },
      nonceCheck: { valid: true },
      requestHash: "abc123",
      responseHash: "def456",
    });
  });

  page.route(apiRoute("/api/verification/register-session"), (route) => {
    logRouteHit("api/verification/register-session", route);
    const body = parseJsonBody(route);
    const verificationId = typeof body.verificationId === "string" ? body.verificationId : "";
    if (!verificationId) {
      route.fulfill({
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "verificationId is required" }),
      });
      return;
    }
    const session = normalizeVerificationSession(verificationId, {
      nonce: typeof body.nonce === "string" ? body.nonce : undefined,
      requestHash:
        typeof body.requestHash === "string" ? body.requestHash : null,
      responseHash:
        typeof body.responseHash === "string" ? body.responseHash : null,
    });
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verificationId,
        nonce: session.nonce,
        requestHash: session.requestHash,
        responseHash: session.responseHash,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      }),
    });
  });

  page.route(apiRoute("/api/verification/session"), (route) => {
    logRouteHit("api/verification/session", route);
    const body = parseJsonBody(route);
    const verificationId = typeof body.verificationId === "string" ? body.verificationId : "";
    if (!verificationId) {
      route.fulfill({
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "verificationId is required" }),
      });
      return;
    }
    let session = normalizeVerificationSession(verificationId, {
      nonce: typeof body.nonce === "string" ? body.nonce : undefined,
      requestHash:
        typeof body.requestHash === "string" ? body.requestHash : null,
      responseHash:
        typeof body.responseHash === "string" ? body.responseHash : null,
    });

    if (typeof body.attestedNonce === "string" && /^[0-9a-f]{64}$/i.test(body.attestedNonce)) {
      session = {
        ...session,
        nonce: body.attestedNonce,
        expiresAt: Date.now() + SESSION_TTL_MS,
      };
      verificationSessions.set(verificationId, session);
    }

    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verificationId,
        nonce: session.nonce,
        requestHash: session.requestHash,
        responseHash: session.responseHash,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      }),
    });
  });
};
