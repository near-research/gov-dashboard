import { expect, test, type Page, type Route } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import screeningFixture from "../fixtures/playwright/screening-response.json";
import {
  mockAuthenticatedSession,
  mockWalletConnected,
} from "./helpers/auth-mocks";

const { describe: describeSpec } = createPlaywrightGuard("draft-workflow.spec.ts");

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const shouldLogMocks = (process.env.PLAYWRIGHT_TEST ?? "").trim().toLowerCase() === "true";
const logMockRoute = (label: string, route: Route) => {
  if (!shouldLogMocks) return;
  const request = route.request();
  console.log(`[draft-workflow mock] ${label} ${request.method()} ${request.url()}`);
};

test.beforeEach(async ({ page }) => {
  page.on("request", (req) => {
    if (req.url().includes("/api/agent") || req.url().includes("/api/evaluateDraft")) {
      console.log("REQUEST:", req.method(), req.url());
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/agent") || res.url().includes("/api/evaluateDraft")) {
      console.log("RESPONSE:", res.status(), res.url());
    }
  });
});

describeSpec("Draft workflow", () => {
  test("editor/preview tabs, quick actions, and AI diff warnings stay in sync", async ({ page }) => {
    await addAnalyticsStub(page);
    registerPlaywrightMocks(page);

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

    await page.route("**/api/evaluateDraft", async (route) => {
      logMockRoute("api/evaluateDraft (rate limit)", route);
      await pause(180);
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
    const publishHeading = page.getByRole("heading", { name: /Publish to Discourse/i });
    await expect(publishHeading).toBeVisible({ timeout: 10000 });
    const publishButton = page.getByRole("button", { name: /Publish to Discourse/ });
    await expect(publishButton).toBeDisabled();
    await expect(page.getByText("Finish the checklist to publish")).toBeVisible();

    const events = await readAnalyticsEvents(page);
    expect(deductPlausibleEvent(events, "draft_evaluation_started")).toBeTruthy();
    expect(deductPlausibleEvent(events, "draft_evaluation_succeeded")).toBeTruthy();
  });
});
