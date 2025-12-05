import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";

const { describe: describeSpec } = createPlaywrightGuard("login.spec.ts");

describeSpec("Login flow (harness)", () => {
  test("connects and disconnects HOT Wallet via test harness", async ({ page }) => {
    registerPlaywrightMocks(page);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window !== "undefined" && !!(window as any).__NEAR_TEST_HARNESS__);

    const connectButton = page.getByRole("button", { name: /Connect HOT Wallet/i });
    await expect(connectButton).toBeVisible();
    await connectButton.click();
    await page.evaluate(() => {
      const harness = (window as typeof window & {
        __NEAR_TEST_HARNESS__?: { emitSignIn?: () => Promise<void> };
      }).__NEAR_TEST_HARNESS__;

      return harness?.emitSignIn?.();
    });

    await expect(page.getByText(/Connected wallet/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /Sign In with HOT Wallet/i })).toBeVisible();

    const disconnectButton = page.getByRole("button", { name: /Disconnect Wallet/i });
    await disconnectButton.click();
    await expect(connectButton).toBeVisible({ timeout: 5000 });
  });
});
