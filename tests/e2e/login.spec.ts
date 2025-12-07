import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import {
  dismissPopups,
  setupAuthenticatedUser,
  waitForAppReady,
} from "./helpers/setup";

const { describe: describeSpec } = createPlaywrightGuard("login.spec.ts");

describeSpec("Login flow (harness)", () => {
  test("connects and disconnects HOT Wallet via test harness", async ({ page }) => {
    registerPlaywrightMocks(page);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    const connectButton = page.getByRole("button", { name: /Connect HOT Wallet/i });
    await expect(connectButton).toBeVisible();
    await connectButton.click();
    await setupAuthenticatedUser(page);
    await dismissPopups(page);

    await expect(page.getByText(/Connected wallet/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /Sign In with HOT Wallet/i })).toBeVisible();

    const disconnectButton = page.getByRole("button", { name: /Disconnect Wallet/i });
    await disconnectButton.click();
    await expect(connectButton).toBeVisible({ timeout: 5000 });
  });
});
