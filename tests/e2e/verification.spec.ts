import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";

const { describe: describeSpec } = createPlaywrightGuard("verification.spec.ts");

describeSpec("Verification proof display", () => {
  test("shows verified badge and proof modal", async ({ page }) => {
    registerPlaywrightMocks(page);
    const targetUrl = "/playwright/verification";

    let response = await page.goto(targetUrl, { waitUntil: "load", timeout: 20000 });
    await expect(response?.status()).toBeLessThan(400);
    const badge = page.getByTestId("verification-status-badge");
    await expect(badge).toHaveCount(1, { timeout: 15000 });
    await expect(badge).toBeVisible({ timeout: 10000 });
    await badge.click();
    await expect(page.getByText(/Attestation passed/)).toBeVisible({
      timeout: 10000,
    });

    response = await page.goto(targetUrl, { waitUntil: "load", timeout: 20000 });
    await expect(response?.status()).toBeLessThan(400);
    await expect(badge).toHaveCount(1, { timeout: 15000 });
    await expect(badge).toBeVisible({ timeout: 10000 });
    await badge.click();
    await expect(page.getByText(/Attestation failed/)).toBeVisible({ timeout: 10000 });
  });
});
