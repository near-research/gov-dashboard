import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";

const { describe: describeSpec } = createPlaywrightGuard("proposals.spec.ts");

describeSpec("Proposals page listing", () => {
  test("renders mocked proposal cards", async ({ page }) => {
    registerPlaywrightMocks(page);
    await page.goto("/proposals", { waitUntil: "networkidle" });

    await expect(page.getByText("Mock Proposal for Playwright")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("playwright-bot")).toBeVisible();
    await expect(page.getByRole("button", { name: /View on Discourse/i })).toBeVisible();
  });
});
