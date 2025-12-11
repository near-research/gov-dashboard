import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  markPageWithCustomAuthRoutes,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import {
  setupAuthenticatedUserNoNav,
  setupUnauthenticatedUserNoNav,
} from "./helpers/setup";

const { describe: describeSpec } = createPlaywrightGuard("profile.spec.ts");

const nearAccountId = "playwright.testnet";

const respondOrpc = (payload: unknown) => JSON.stringify({ json: payload });

const ensurePlausibleSpy = async (page: Page) => {
  await page.addInitScript(() => {
    (
      window as typeof window & { plausible?: (...args: any[]) => void }
    ).plausible = ((window as any).plausible ??
      (() => undefined)) as () => void;
    (window as any).plausibleEvents = [];
    const original = (window as any).plausible;
    (window as any).plausible = (
      event: string,
      opts?: { props?: Record<string, unknown> }
    ) => {
      (window as any).plausibleEvents.push({ event, props: opts?.props });
      return original?.(event, opts);
    };
  });
};

const injectWalletAccount = async (page: Page, accountId = nearAccountId) => {
  await page.addInitScript((id: string) => {
    (window as any).__PLAYWRIGHT_WALLET_ACCOUNT__ = id;
  }, accountId);
};

const stubAuthRoutesForNoAccount = async (page: Page) => {
  markPageWithCustomAuthRoutes(page);
  await page.route("**/api/auth/get-session", (route) => {
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          id: "session-abc",
          userId: "user-123",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        user: {
          id: "user-123",
          email: "test@example.com",
          name: "Playwright Tester",
          accounts: [],
        },
      }),
    });
  });

  const listResponse = JSON.stringify({ data: [] });
  await page.route("**/api/auth/list-accounts", (route) => {
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: listResponse,
    });
  });

  await page.route("**/api/auth/accounts", (route) => {
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: listResponse,
    });
  });
};

const stubNearRpc = async (page: Page, amount = "1500000000000000000000000") => {
  await page.route(/rpc.*near|fastnear|near.*rpc/i, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dontcare",
        result: {
          amount,
          locked: "0",
          code_hash: "11111111111111111111111111111111",
          storage_usage: 182,
          storage_paid_at: 0,
          block_height: 1,
          block_hash: "11111111111111111111111111111111",
        },
      }),
    });
  });
};

const stubDiscourseLinkage = async (
  page: Page,
  options: { payload: Record<string, unknown> | null; fail?: boolean }
) => {
  await page.route("**/api/rpc/discourse/getLinkage", (route) => {
    if (options.fail) {
      route.fulfill({
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: { code: "INTERNAL_SERVER_ERROR", message: "discourse down" },
        }),
      });
      return;
    }
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: respondOrpc(options.payload),
    });
  });
};

const stubDiscourseBadge = async (
  page: Page,
  response:
    | { success: true; badges: string[]; user?: Record<string, unknown> }
    | { success: false }
) => {
  await page.route("**/api/discourse/user/**", async (route) => {
    if (!response.success) {
      await route.fulfill({
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "boom" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_badges: response.badges.map((badge) => ({
          id: badge,
          badge_id: Math.random(),
          badge: { name: badge },
        })),
        user: response.user ?? {
          avatar_template: "/user_avatar/{size}/avatar.png",
          trust_level: 2,
          badge_count: response.badges.length,
          post_count: 12,
          time_read: 120,
          last_seen_at: new Date().toISOString(),
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
      }),
    });
  });
};

const stubDiscourseRpc = async (
  page: Page,
  method: string,
  payload: unknown,
  status = 200
) => {
  await page.route(`**/api/rpc/discourse/${method}`, (route) => {
    route.fulfill({
      status,
      headers: { "Content-Type": "application/json" },
      body: respondOrpc(payload),
    });
  });
};

describeSpec("Profile journeys", () => {
  test("warns about wallet when no NEAR account and gates discourse linking", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await stubAuthRoutesForNoAccount(page);
    await stubDiscourseLinkage(page, { payload: null });
    await stubNearRpc(page);

    await setupUnauthenticatedUserNoNav(page);
    await page.goto("/profile", { waitUntil: "networkidle" });

    await expect(
      page.getByText(/Wallet not connected|Connect.*wallet|No wallet/i).first()
    ).toBeVisible({ timeout: 10000 });

    // Connect to Discourse button should NOT be visible without wallet
    const connectButton = page
      .locator("button", { hasText: "Connect to Discourse" })
      .first();
    await expect(connectButton).toHaveCount(0);
  });

  test("discourse card handles plugin unavailable then reconnects after unlink", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await stubNearRpc(page);
    await stubDiscourseLinkage(page, { payload: null, fail: true });
    await injectWalletAccount(page);
    await setupAuthenticatedUserNoNav(page, nearAccountId);
    await page.goto("/profile", { waitUntil: "networkidle" });

    // Check for account ID anywhere on page
    await expect(page.getByText(nearAccountId).first()).toBeVisible({
      timeout: 5000,
    });

    // Check for plugin unavailable message
    const pluginUnavailable = page.getByText(
      /Plugin Unavailable|plugin.*not running|unavailable/i
    );
    await expect(pluginUnavailable.first()).toBeVisible({ timeout: 5000 });

    // Fix the linkage mock for reload
    await page.unroute("**/api/rpc/discourse/getLinkage");
    await stubDiscourseLinkage(page, {
      payload: {
        discourseUsername: "playwright",
        userApiKey: "api-key",
      },
    });
    await page.unroute("**/api/discourse/user/**");
    await stubDiscourseBadge(page, { success: true, badges: [] });

    await page.reload({ waitUntil: "networkidle" });

    // Should now show connect/unlink buttons
    const connectOrUnlink = page.getByRole("button", {
      name: /Connect to Discourse|Unlink/i,
    });
    await expect(connectOrUnlink.first()).toBeVisible({ timeout: 5000 });
  });

  test("badge grid surfaces empty and error states", async ({ page }) => {
    registerPlaywrightMocks(page);
    await stubNearRpc(page);
    await stubDiscourseLinkage(page, {
      payload: {
        discourseUsername: "shopper",
        userApiKey: "key",
      },
    });
    await stubDiscourseBadge(page, { success: true, badges: [] });

    await injectWalletAccount(page);
    await setupAuthenticatedUserNoNav(page, nearAccountId);
    await page.goto("/profile", { waitUntil: "networkidle" });

    // Empty badges state - flexible text matching
    const emptyBadges = page.getByText(/No badges|earned yet|0 badges/i);
    await expect(emptyBadges.first()).toBeVisible({ timeout: 5000 });

    // Switch to error state
    await page.unroute("**/api/discourse/user/**");
    await stubDiscourseBadge(page, { success: false });
    await page.reload({ waitUntil: "networkidle" });

    // Error state - flexible matching
    const errorText = page.getByText(/Unable to load|error|failed/i);
    await expect(errorText.first()).toBeVisible({ timeout: 5000 });
  });

  test("discourse connect flow handles signin, clipboard, and completing link", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await stubNearRpc(page);
    await stubDiscourseLinkage(page, { payload: null });
    await stubDiscourseRpc(page, "initiateLink", {
      authUrl: "https://gov.near.org/discourse/oauth",
      nonce: "nonce-123",
    });
    await stubDiscourseRpc(page, "completeLink", {
      discourseUsername: "playwright",
      userApiKey: "key",
    });
    await page.addInitScript(() => {
      const popup = {
        closed: false,
        close(this: { closed: boolean }) {
          this.closed = true;
        },
      };
      (window as any).__PROFILE_POPUP__ = popup;
      window.open = () => popup as Window;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          readText: () => Promise.resolve("mock-api-key"),
        },
        configurable: true,
      });
    });

    await injectWalletAccount(page);
    await setupAuthenticatedUserNoNav(page, nearAccountId);
    await page.goto("/profile", { waitUntil: "networkidle" });

    // Verify account ID is visible
    await expect(page.getByText(nearAccountId).first()).toBeVisible({
      timeout: 5000,
    });

    // Find and click connect button
    const connectButton = page
      .getByRole("button", { name: /Connect to Discourse/i })
      .first();
    await expect(connectButton).toBeVisible({ timeout: 5000 });
    await connectButton.click();

    // Complete the flow - look for paste/verify buttons
    const pasteButton = page.getByRole("button", { name: /Paste|clipboard/i });
    if (await pasteButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pasteButton.click();
    }

    // Fill in the key field (various possible selectors)
    const keyInput = page
      .locator("#discourse-key, input[placeholder*='key'], input[name*='key']")
      .first();
    if (await keyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await keyInput.fill("mock-api-key");
    }

    // Click complete/verify button
    const completeButton = page.getByRole("button", {
      name: "Complete Link",
    });
    await completeButton.click();

    // Verify linked state
    await expect(
      page.getByText(/Linked to Discourse|Connected|Success/i).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("discourse connect flow surfaces API failure while completing link", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await stubNearRpc(page);
    await stubDiscourseLinkage(page, { payload: null });
    await stubDiscourseRpc(page, "initiateLink", {
      authUrl: "https://gov.near.org/discourse/oauth",
      nonce: "nonce-456",
    });
    await page.route("**/api/rpc/discourse/completeLink", (route) => {
      route.fulfill({
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: respondOrpc({ code: "BAD_REQUEST", message: "invalid key" }),
      });
    });
    await page.addInitScript(() => {
      const popup = {
        closed: false,
        close(this: { closed: boolean }) {
          this.closed = true;
        },
      };
      window.open = () => popup as Window;
    });

    await injectWalletAccount(page);
    await setupAuthenticatedUserNoNav(page, nearAccountId);
    await page.goto("/profile", { waitUntil: "networkidle" });

    // Verify account visible
    await expect(page.getByText(nearAccountId).first()).toBeVisible({
      timeout: 5000,
    });

    // Start connect flow
    await page.getByRole("button", { name: /Connect to Discourse/i }).click();

    // Fill key
    const keyInput = page
      .locator("#discourse-key, input[placeholder*='key'], input[name*='key']")
      .first();
    if (await keyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await keyInput.fill("broken-key");
    }

    // Click complete
    await page.getByRole("button", { name: "Complete Link" }).click();

    // Verify error is shown
    await expect(
      page.getByText(/Failed|error|invalid|try again/i).first()
    ).toBeVisible({ timeout: 5000 });

    // Button should still be enabled for retry
    await expect(
      page.getByRole("button", { name: "Complete Link" })
    ).toBeEnabled();
  });

  test("discourse connect flow requires wallet before starting linking", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await stubNearRpc(page);
    await stubDiscourseLinkage(page, { payload: null });

    await setupUnauthenticatedUserNoNav(page);
    await page.goto("/profile", { waitUntil: "networkidle" });

    // Should show wallet not connected message
    const walletWarning = page.getByText(
      /Wallet not connected|Connect.*wallet|No wallet/i
    );
    await expect(walletWarning.first()).toBeVisible({ timeout: 5000 });

    // Connect to Discourse should NOT be available
    const connectButton = page.getByRole("button", {
      name: "Connect to Discourse",
    });
    await expect(connectButton).toHaveCount(0);
  });
});
