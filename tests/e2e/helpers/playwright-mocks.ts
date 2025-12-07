import { randomBytes } from "crypto";
import type { Page, Route } from "@playwright/test";
import type { AGUIEvent } from "@/types/agui-events";
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
};

export const markPageWithCustomAuthRoutes = (page: Page) => {
  (page as PageWithAuthOverride).__hasCustomAuthRoutes__ = true;
};
const logRouteHit = (label: string, route: Route) => {
  if (!shouldLogMocks) return;
  const request = route.request();
  console.debug(`[playwright mock] ${label} ${request.method()} ${request.url()}`);
};

const respondWithJson = (route: Route, payload: unknown) => {
  route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

const createSsePayload = (events: Record<string, unknown>[]) =>
  `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;

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
      respondWithJson(route, payload);
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

  page.route("/api/screen", (route) => {
    logRouteHit("api/screen", route);
    respondWithJson(route, screeningFixture);
  });

  page.route(/\/api\/discourse\/topics\/\d+\/summarize/, (route) => {
    logRouteHit("api/discourse/topics/:id/summarize", route);
    respondWithJson(route, topicSummaryFixture);
  });

  page.route(/\/api\/discourse\/replies\/\d+\/summarize/, (route) => {
    logRouteHit("api/discourse/replies/:id/summarize", route);
    respondWithJson(route, replySummaryFixture);
  });

  if (!options?.skipChatCompletionsStream) {
    page.route("/api/chat/completions", (route) => {
      logRouteHit("api/chat/completions", route);
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        body: createSsePayload([
          {
            id: "mock-chat-message-1",
            object: "chat.completion.chunk",
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
            id: "mock-chat-message-2",
            object: "chat.completion.chunk",
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
            id: "mock-chat-message-3",
            object: "chat.completion.chunk",
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
        ]),
      });
    });
  }

  page.route("/api/agent", (route) => {
    logRouteHit("api/agent", route);
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: createSsePayload([
        {
          id: "mock-agent-message-1",
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                role: "assistant",
                content: "Agent flow returns a tool-assisted verdict.",
              },
              index: 0,
              finish_reason: null,
            },
          ],
        },
        {
          id: "mock-agent-message-2",
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                role: "assistant",
                content: "Agent final report ready.",
              },
              index: 0,
              finish_reason: "stop",
            },
          ],
        },
      ]),
    });
  });

  page.route("/api/verification/proof", (route) => {
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

  page.route("/api/verification/register-session", (route) => {
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

  page.route("/api/verification/session", (route) => {
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
