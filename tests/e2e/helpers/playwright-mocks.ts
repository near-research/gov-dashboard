import type { Page, Route } from "@playwright/test";
import proposalsFixture from "../../fixtures/playwright/proposals-latest.json";
import screeningFixture from "../../fixtures/playwright/screening-response.json";
import topicSummaryFixture from "../../fixtures/playwright/discourse-topic-summary.json";
import replySummaryFixture from "../../fixtures/playwright/discourse-reply-summary.json";
import proposalDetailFixture from "../../fixtures/playwright/proposal-detail.json";
import proposalRevisionsFixture from "../../fixtures/playwright/proposal-revisions.json";
import revisionSummaryFixture from "../../fixtures/playwright/proposal-revision-summary.json";
import revisionAnalysesFixture from "../../fixtures/playwright/revision-analyses.json";

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

export const registerPlaywrightMocks = (page: Page) => {
  page.route(/\/api\/auth(\/.*)?$/, (route) => {
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

  page.route(/\/api\/discourse\/latest/, (route) => respondWithJson(route, proposalsFixture));

  const proposalId = String(proposalDetailFixture.topic_id ?? 42);
  page.route(new RegExp(`/api/proposals/${proposalId}$`), (route) => {
    if (route.request().method() === "GET") {
      respondWithJson(route, proposalDetailFixture);
      return;
    }
    route.continue();
  });

  page.route(new RegExp(`/api/proposals/${proposalId}/revisions$`), (route) => {
    if (route.request().method() === "GET") {
      respondWithJson(route, proposalRevisionsFixture);
      return;
    }
    route.continue();
  });

  page.route(new RegExp(`/api/proposals/${proposalId}/revisions/summarize$`), (route) => {
    if (route.request().method() === "POST") {
      respondWithJson(route, revisionSummaryFixture);
      return;
    }
    route.continue();
  });

  page.route(/\/api\/getAnalysis\/\d+/, (route) => {
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

  page.route("/api/screen", (route) => respondWithJson(route, screeningFixture));

  page.route(/\/api\/discourse\/topics\/\d+\/summarize/, (route) =>
    respondWithJson(route, topicSummaryFixture)
  );

  page.route(/\/api\/discourse\/replies\/\d+\/summarize/, (route) =>
    respondWithJson(route, replySummaryFixture)
  );

  page.route("/api/chat/completions", (route) => {
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: createSsePayload([
        {
          event: {
            type: "message.delta",
            delta: "NEAR AI assistant says hello from the mocked stream.",
            role: "assistant",
            id: "mock-chat-message",
          },
        },
        {
          event: {
            type: "message.delta",
            delta: "Here is a quick plan for governance updates.",
            role: "assistant",
            id: "mock-chat-message",
          },
        },
        {
          event: {
            type: "message",
            delta: "Final thought from NEAR AI.",
            role: "assistant",
            id: "mock-chat-message",
          },
        },
      ]),
    });
  });

  page.route("/api/agent", (route) => {
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: createSsePayload([
        {
          event: {
            type: "message.delta",
            delta: "Agent flow returns a tool-assisted verdict.",
            role: "assistant",
            id: "mock-agent-message",
          },
        },
        {
          event: {
            type: "message",
            delta: "Agent final report ready.",
            role: "assistant",
            id: "mock-agent-message",
          },
        },
      ]),
    });
  });

  page.route("/api/verification/proof", (route) => {
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
};
