import { expect, test, type Page, type Route } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import screeningFixture from "../fixtures/playwright/screening-response.json";
import {
  mockAuthenticatedSession,
  mockWalletConnected,
} from "./helpers/auth-mocks";

const { describe: describeSpec } = createPlaywrightGuard(
  "draft-workflow.spec.ts"
);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const addAnalyticsStub = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__plausibleEvents = [];
    window.plausible = (
      event: string,
      options?: { props?: Record<string, unknown> }
    ) => {
      (window as any).__plausibleEvents.push({
        event,
        props: options?.props ?? null,
      });
    };
  });
};

const readAnalyticsEvents = async (page: Page) =>
  page.evaluate(
    () => ((window as any).__plausibleEvents ?? []) as Array<{ event: string }>
  );

const deductPlausibleEvent = (events: Array<{ event: string }>, name: string) =>
  events.some((entry) => entry.event === name);

const shouldLogMocks =
  (process.env.PLAYWRIGHT_TEST ?? "").trim().toLowerCase() === "true";
const logMockRoute = (label: string, route: Route) => {
  if (!shouldLogMocks) return;
  const request = route.request();
  console.log(
    `[draft-workflow mock] ${label} ${request.method()} ${request.url()}`
  );
};

test.beforeEach(async ({ page }) => {
  page.on("request", (req) => {
    if (
      req.url().includes("/api/agent") ||
      req.url().includes("/api/evaluateDraft")
    ) {
      console.log("REQUEST:", req.method(), req.url());
    }
  });
  page.on("response", (res) => {
    if (
      res.url().includes("/api/agent") ||
      res.url().includes("/api/evaluateDraft")
    ) {
      console.log("RESPONSE:", res.status(), res.url());
    }
  });
});

describeSpec("Draft workflow", () => {
  test("editor/preview tabs, quick actions, and AI diff warnings stay in sync", async ({
    page,
  }) => {
    await addAnalyticsStub(page);
    registerPlaywrightMocks(page);
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("EVAL-DEBUG")) {
        console.log("PAGE LOG:", text);
      }
    });
    await page.route("**/api/evaluateDraft", async (route) => {
      logMockRoute("api/evaluateDraft (quick-action)", route);
      await pause(120);
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(screeningFixture),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const draftButton = page.getByRole("button", { name: "Draft" });
    await expect(draftButton).toBeVisible();
    await draftButton.click();
    await page.waitForURL("/proposals/new");

    const titleInput = page.getByLabel("Title");
    const contentInput = page.getByLabel("Content");
    await expect(
      page.getByRole("heading", { name: "Proposal Editor" })
    ).toBeVisible();
    await titleInput.fill("NEAR governance refresh");
    await contentInput.fill("Initial working draft with objectives and KPIs.");

    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.getByText("NEAR governance refresh")).toBeVisible();
    await page.getByRole("tab", { name: "Editor" }).click();

    const quickAction = page.getByRole("button", {
      name: /Screen this proposal/,
    });
    await expect(quickAction).toBeVisible();
    await quickAction.click();

    await expect(page.getByText("Passes screening")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Quality 0.9")).toBeVisible();
    await expect(page.getByText("Attention 0.9")).toBeVisible();
  });

  test("evaluation panel validates inputs, surfaces rate limits, shows verification proof, and keeps publish gated", async ({
    page,
  }) => {
    await addAnalyticsStub(page);
    registerPlaywrightMocks(page);
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("EVAL-DEBUG")) {
        console.log("PAGE LOG:", text);
      }
    });

    await page.route("**/api/evaluateDraft", async (route) => {
      logMockRoute("api/evaluateDraft (chat)", route);
      await pause(180);

      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(screeningFixture),
      });
    });

    await page.goto("/proposals/new", { waitUntil: "domcontentloaded" });
    const screenButton = page.getByRole("button", {
      name: /Screen this proposal/,
    });
    await expect(screenButton).toBeVisible();

    await screenButton.click();
    await expect(
      page.getByText("Please enter both title and proposal content.")
    ).toBeVisible();

    await page.getByLabel("Title").fill("Screened Title");
    await page
      .getByLabel("Content")
      .fill("Complete draft content ready for screening.");
    await screenButton.click();

    await expect(page.getByText("Passes screening")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText(
        "Mock screening result: the proposal is ready for submission with clear roadmap and metrics."
      )
    ).toBeVisible();
    await expect(page.getByText("Quality 0.9")).toBeVisible();
    await expect(page.getByText("Attention 0.9")).toBeVisible();

    await expect(page.getByText(/^Passing$/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Publish to Forum/ })
    ).toBeVisible({ timeout: 5000 });
    const publishButton = page.getByRole("button", {
      name: /Publish to Forum/,
    });
    await expect(publishButton).toBeDisabled();
    await expect(
      page.getByText("Finish the checklist to publish")
    ).toBeVisible();

    const events = await readAnalyticsEvents(page);
    expect(
      deductPlausibleEvent(events, "draft_evaluation_started")
    ).toBeTruthy();
    expect(
      deductPlausibleEvent(events, "draft_evaluation_succeeded")
    ).toBeTruthy();
  });
});
