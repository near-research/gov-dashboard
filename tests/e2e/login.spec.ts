import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import {
  mockUnauthenticatedSession,
  mockWalletConnected,
} from "./helpers/auth-mocks";

const { describe: describeSpec } = createPlaywrightGuard("login.spec.ts");

describeSpec("Login flow (mocked auth)", () => {
  test("connects and disconnects HOT Wallet via mocks", async ({ page }) => {
    registerPlaywrightMocks(page);
    await mockWalletConnected(page, "test.near");
    await mockUnauthenticatedSession(page);
    await page.goto("/login", { waitUntil: "networkidle" });

    const connectButton = page.getByRole("button", {
      name: /Connect (?:HOT )?Wallet/i,
    });
    await expect(connectButton).toBeVisible();

    await mockWalletConnected(page, "test.near");
    await connectButton.click();

    await expect(page.getByText(/test\.near/i).first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole("button", { name: /Sign In with HOT Wallet/i })
    ).toBeVisible();

    const disconnectButton = page.getByRole("button", { name: /Disconnect Wallet/i });
    await disconnectButton.click();

    await expect(
      page.getByRole("button", { name: /Connect (?:HOT )?Wallet/i })
    ).toBeVisible({ timeout: 5000 });

    await mockUnauthenticatedSession(page);
    await mockWalletConnected(page, "test.near");
    const connectButtonAgain = page.getByRole("button", {
      name: /Connect (?:HOT )?Wallet/i,
    });
    await connectButtonAgain.click();

    await expect(page.getByText(/test\.near/i).first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole("button", { name: /Sign In with HOT Wallet/i })
    ).toBeVisible();
  });
});
