import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import { mockDiscourseAPI } from "./helpers/setup";

const { describe: describeSpec } = createPlaywrightGuard("proposals.spec.ts");

describeSpec("Proposals page listing", () => {
  test("renders mocked proposal cards", async ({ page }) => {
    registerPlaywrightMocks(page);
    await mockDiscourseAPI(page);
    await page.goto("/proposals", { waitUntil: "networkidle" });

    await expect(page.getByText("Mock Proposal for Playwright")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("playwright-bot")).toBeVisible();
    await expect(page.getByRole("button", { name: /View on Discourse/i })).toBeVisible();
  });
});
