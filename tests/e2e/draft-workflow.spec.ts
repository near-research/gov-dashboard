import { expect, test, type Page } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import screeningFixture from "../fixtures/playwright/screening-response.json";
import { EventType } from "@/types/agui-events";

const { describe: describeSpec } = createPlaywrightGuard("draft-workflow.spec.ts");

const createSsePayload = (events: unknown[]) =>
  `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;

const addAnalyticsStub = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__plausibleEvents = [];
    window.plausible = (event: string, options?: { props?: Record<string, unknown> }) => {
      (window as any).__plausibleEvents.push({ event, props: options?.props ?? null });
    };
  });
};

const readAnalyticsEvents = async (page: Page) =>
  page.evaluate(() => ((window as any).__plausibleEvents ?? []) as Array<{ event: string }>);

const deductPlausibleEvent = (events: Array<{ event: string }>, name: string) =>
  events.some((entry) => entry.event === name);

describeSpec("Draft workflow", () => {
  test("editor/preview tabs, quick actions, and AI diff warnings stay in sync", async ({ page }) => {
    await addAnalyticsStub(page);
    registerPlaywrightMocks(page);

    await page.unroute("/api/agent");
    const agentEvents = [
      { type: EventType.RUN_STARTED, threadId: "draft-thread", runId: "run-1" },
      { type: EventType.TEXT_MESSAGE_START, messageId: "msg-agent", role: "assistant" },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg-agent",
        delta: "NEAR AI assistant says hello from the mocked stream.",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg-agent",
        delta: "Here is a quick plan for governance updates.",
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
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: "msg-agent" },
      { type: EventType.RUN_FINISHED, threadId: "draft-thread", runId: "run-1" },
    ];

    await page.route("/api/agent", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body: createSsePayload(agentEvents),
      })
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const draftButton = page.getByRole("button", { name: "Draft" });
    await expect(draftButton).toBeVisible();
    await draftButton.click();
    await page.waitForURL("/proposals/new");

    const titleInput = page.getByLabel("Title");
    const contentInput = page.getByLabel("Content");
    await expect(page.getByRole("heading", { name: "Proposal Editor" })).toBeVisible();
    await titleInput.fill("NEAR governance refresh");
    await contentInput.fill("Initial working draft with objectives and KPIs.");

    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.getByText("NEAR governance refresh")).toBeVisible();
    await page.getByRole("tab", { name: "Editor" }).click();

    const quickAction = page.getByRole("button", { name: /Screen this proposal against NEAR criteria/ });
    await expect(quickAction).toBeVisible();
    await quickAction.click();

    await expect(
      page.getByText("NEAR AI assistant says hello from the mocked stream.")
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("AI Suggested Changes")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  });

  test("evaluation panel validates inputs, surfaces rate limits, shows verification proof, and keeps publish gated", async ({
    page,
  }) => {
    await addAnalyticsStub(page);
    registerPlaywrightMocks(page);
    let evaluationCall = 0;

    await page.route("/api/evaluateDraft", (route) => {
      evaluationCall += 1;
      if (evaluationCall === 1) {
        route.fulfill({
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": "2",
            "X-RateLimit-Reset": "120",
          },
          body: JSON.stringify({ error: "Too many requests" }),
        });
        return;
      }

      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(screeningFixture),
      });
    });

    await page.goto("/proposals/new", { waitUntil: "domcontentloaded" });
    const runButton = page.getByRole("button", { name: /Run screening/ });
    await runButton.click();
    await expect(
      page.getByText("Please enter both title and proposal content.")
    ).toBeVisible();

    await page.getByLabel("Title").fill("Screened Title");
    await page.getByLabel("Content").fill("Complete draft content ready for screening.");
    await runButton.click();
    await expect(page.getByRole("button", { name: /Evaluating.../ })).toBeVisible();
    await expect(page.getByText(/Rate limit exceeded/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/You can do 2 more evaluation/)).toBeVisible();

    await runButton.click();
    await expect(page.getByText(/Result: Pass/)).toBeVisible({ timeout: 10000 });
    const showDetails = page.getByRole("button", { name: /Show results/i });
    await showDetails.click();
    await expect(page.getByText(/Mock screening result/)).toBeVisible();
    await expect(page.getByRole("button", { name: /View proof details/i })).toBeVisible();

    const publishButton = page.getByRole("button", { name: /Publish to Discourse/ });
    await expect(publishButton).toBeDisabled();
    await expect(page.getByText("Finish the checklist to publish")).toBeVisible();

    const events = await readAnalyticsEvents(page);
    expect(deductPlausibleEvent(events, "draft_evaluation_started")).toBeTruthy();
    expect(deductPlausibleEvent(events, "draft_evaluation_succeeded")).toBeTruthy();
  });

  test("publish bar requires evaluation, NEAR wallet & Discourse linking, and surfaces publish success/failure", async ({
    page,
  }) => {
    await addAnalyticsStub(page);
    registerPlaywrightMocks(page);

    await page.route("/api/evaluateDraft", (route) =>
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(screeningFixture),
      })
    );

    let linkageEnabled = false;
    await page.route("/api/rpc/discourse/getLinkage", async (route) => {
      const payload = JSON.parse(route.request().postData() || "{}");
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: linkageEnabled
            ? {
                nearAccount: payload?.json?.nearAccount || "playwright.testnet",
                discourseUsername: "playwright-user",
              }
            : null,
        }),
      });
    });

    await page.route("/api/rpc/discourse/getUserApiAuthUrl", (route) =>
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: {
            authUrl: "https://mock.discourse/auth",
            nonce: "nonce-777",
            expiresAt: new Date().toISOString(),
          },
        }),
      })
    );

    await page.route("/api/rpc/discourse/completeLink", (route) => {
      linkageEnabled = true;
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: {
            userApiKey: "mock-key",
            discourseUsername: "playwright-user",
            discourseUserId: 999,
          },
        }),
      });
    });

    let publishCount = 0;
    await page.route("/api/rpc/discourse/createPost", (route) => {
      publishCount += 1;
      if (publishCount === 1) {
        route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            json: {
              success: true,
              postUrl: "https://gov.near.org/topic/99",
              topicId: 99,
            },
          }),
        });
        return;
      }
      route.fulfill({
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: {
            code: "SERVER_ERROR",
            message: "Mock publish failure",
          },
        }),
      });
    });

    await page.goto("/proposals/new", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Title").fill("Near governance update for publication");
    await page.getByLabel("Content").fill("Publish-ready draft with NEP-413 requirements.");
    await page.getByRole("button", { name: /Run screening/ }).click();
    await expect(page.getByText(/Result: Pass/)).toBeVisible({ timeout: 10000 });

    const publishButton = page.getByRole("button", { name: /Publish to Discourse/ });
    await expect(publishButton).toBeDisabled();
    await expect(page.getByRole("button", { name: /Connect NEAR account/ })).toBeVisible();

    await page.waitForFunction(
      () => typeof window !== "undefined" && !!(window as any).__NEAR_TEST_HARNESS__
    );
    const connectButton = page.getByRole("button", { name: /Connect NEAR account/ });
    await connectButton.click();
    await page.evaluate(() => (window as any).__NEAR_TEST_HARNESS__?.emitSignIn?.());
    await expect(page.getByRole("button", { name: /Link Discourse account/ })).toBeVisible();

    await page.evaluate(() => {
      window.open = () =>
        ({
          closed: false,
          close() {
            /* no-op */
          },
          focus() {
            /* no-op */
          },
        } as unknown as Window);
    });

    await page.getByRole("button", { name: /Get auth link/ }).click();
    await page.getByPlaceholder("Paste User API key...").fill("mock-key");
    await page.getByRole("button", { name: /Verify & link/i }).click();
    await expect(publishButton).toBeEnabled();

    await publishButton.click();
    await expect(page.getByRole("link", { name: /View published proposal/i })).toBeVisible({
      timeout: 10000,
    });

    await publishButton.click();
    await expect(page.getByRole("alert").filter({ hasText: /Mock publish failure/i })).toBeVisible();

    const events = await readAnalyticsEvents(page);
    expect(deductPlausibleEvent(events, "draft_publish_clicked")).toBeTruthy();
    expect(deductPlausibleEvent(events, "draft_publish_succeeded")).toBeTruthy();
    expect(deductPlausibleEvent(events, "draft_publish_failed")).toBeTruthy();
  });
});
