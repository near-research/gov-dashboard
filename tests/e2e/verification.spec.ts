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
    const proofTrigger = page.getByTestId("verification-proof-trigger");
    await expect(proofTrigger).toHaveCount(1, { timeout: 15000 });
    await expect(proofTrigger).toBeVisible({ timeout: 10000 });
    await proofTrigger.click();
    await expect(page.getByText("Secure Key Generation")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Message Signature")).toBeVisible({ timeout: 10000 });

    await page.keyboard.press("Escape");
    await proofTrigger.click();
    await expect(
      page.getByText("Hardware Attestation", { exact: true })
    ).toBeVisible({ timeout: 10000 });
    await page.keyboard.press("Escape");
  });
});
