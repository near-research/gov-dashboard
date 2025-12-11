import { expect, test, type Page } from "@playwright/test";
import proposalDetailFixture from "../fixtures/playwright/proposal-detail.json";
import {
  mockProposalRevisions,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import { mockAuthenticatedSession } from "./helpers/auth-mocks";

const { describe: describeSpec } = createPlaywrightGuard("proposals-topic.spec.ts");
const PROPOSAL_ID = "42";
const PROPOSAL_TITLE = "Mock Proposal for Playwright";
const PROPOSAL_SLUG = proposalDetailFixture.topic_slug;

const createSsePayload = (events: Record<string, unknown>[]) =>
  `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;

describeSpec("Proposal topic detail walkthrough", () => {
  test("surfaces an alert when the proposal detail fetch fails", async ({ page }) => {
    await page.route(new RegExp(`/api/proposals/${PROPOSAL_ID}$`), async (route) => {
      await route.fulfill({
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "boom" }),
      });
    });

    registerPlaywrightMocks(page);
    await page.goto(`/proposals/${PROPOSAL_ID}`, { waitUntil: "domcontentloaded" });

    // DEBUG: capture what the error state renders
    await page.screenshot({ path: "test-results/proposals-error-debug.png" });
    const alerts = await page.locator('[role="alert"]').all();
    console.log("Alerts found:", alerts.length);
    for (let i = 0; i < alerts.length; i += 1) {
      const text = await alerts[i].textContent().catch(() => "");
      console.log(`Alert[${i}]:`, text);
    }
    const errorTexts = await page
      .locator("text=/error|fail|not found/i")
      .all();
    console.log("Error texts found:", errorTexts.length);

    const errorAlert = alerts.length ? alerts[0] : page.locator('[role="alert"]').first();
    await expect(errorAlert).toBeVisible({ timeout: 5000 });
    await expect(errorAlert).toHaveText(/\/proposals\/\d+/);
  });
});
