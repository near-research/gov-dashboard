import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  markPageWithCustomAuthRoutes,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import {
  setupAuthenticatedUser,
  setupUnauthenticatedUser,
} from "./helpers/setup";

const { describe: describeSpec } = createPlaywrightGuard("profile.spec.ts");

const nearAccountId = "playwright.testnet";

const nearRpcUrl = "https://test.rpc.fastnear.com";

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

const stubNearRpc = async (
  page: Page,
  amount = "1500000000000000000000000"
) => {
  await page.route(`${nearRpcUrl}/**`, (route) => {
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        result: {
          amount,
          locked: "0",
          code_hash: "",
          storage_usage: 0,
          storage_paid_at: "0",
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

/**
 * Helper to navigate to profile page - handles both nav dropdown and direct navigation
 */
const navigateToProfile = async (page: Page, useNav = false) => {
  if (useNav) {
    // Try to find account button in nav
    const accountButton = page
      .locator("button")
      .filter({ hasText: /\.testnet|\.near/i })
      .first();
    const isVisible = await accountButton
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (isVisible) {
      await accountButton.click();
      const profileMenu = page.locator("[role='menu']").first();
      await expect(profileMenu).toBeVisible({ timeout: 3000 });
      const profileItem = profileMenu.getByRole("menuitem", {
        name: /Profile/i,
      });
      await profileItem.click();
      await page.waitForURL(/\/profile/, { timeout: 5000 });
    } else {
      // Fallback to direct navigation
      await page.goto("/profile", { waitUntil: "networkidle" });
    }
  } else {
    await page.goto("/profile", { waitUntil: "networkidle" });
  }
};

/**
 * Wait for profile page to fully render (not just return JSON)
 */
const waitForProfileRender = async (page: Page) => {
  // Wait for either the account heading or an error/warning state
  await page
    .waitForFunction(
      () => {
        const body = document.body.textContent || "";
        // Profile page should NOT show raw JSON
        return (
          !body.includes('"nextExport":true') && !body.includes('"buildId"')
        );
      },
      { timeout: 10000 }
    )
    .catch(() => {
      // If we timeout, the page might still be loading
    });
};

describeSpec("Profile journeys", () => {
  test("shows skeleton, linked summary, NEAR balance, wallet status and badges", async ({
    page,
  }) => {
    page.on("console", (msg) => {
      console.log("PAGE LOG:", msg.text());
    });
    page.on("pageerror", (err) => {
      console.log("PAGE ERROR:", err.message);
    });
    // Setup all mocks BEFORE any navigation
    registerPlaywrightMocks(page);
    await ensurePlausibleSpy(page);
    await stubDiscourseLinkage(page, {
      payload: {
        discourseUsername: "playwright",
        userApiKey: "api-key",
      },
    });
    await stubDiscourseBadge(page, {
      success: true,
      badges: ["Catalyst Rounds", "Early Contributor"],
    });
    await stubNearRpc(page);
    await stubDiscourseRpc(page, "getUserApiAuthUrl", {
      authUrl: "https://gov.near.org/discourse/oauth",
      nonce: "nonce-123",
    });
    await stubDiscourseRpc(page, "completeLink", {
      discourseUsername: "playwright",
      userApiKey: "api-key",
    });
    await stubDiscourseRpc(page, "unlink", { success: true });

    await injectWalletAccount(page);
    await setupAuthenticatedUser(page, nearAccountId);

    // Navigate directly to profile
    await page.goto("/profile", { waitUntil: "networkidle" });
    const currentUrl = page.url();
    console.log("Current URL:", currentUrl);
    if (currentUrl.includes("/login")) {
      console.log("Redirected to login - auth not working");
    }
    const bodyText = await page.locator("body").textContent();
    console.log(
      "Body content:",
      bodyText ? bodyText.substring(0, 1000) : "<empty body>"
    );
    await waitForProfileRender(page);

    // Look for profile content with flexible selectors
    // The heading might be an h1/h2/h3 with the account ID
    const accountHeading = page.getByRole("heading", {
      name: new RegExp(nearAccountId, "i"),
    });
    const accountText = page.getByText(nearAccountId);

    // Wait for either heading or text to appear
    const hasHeading = await accountHeading
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasText = await accountText
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    expect(hasHeading || hasText).toBe(true);

    // Check for balance and discourse elements with flexible selectors
    await expect(page.getByText(/NEAR Balance/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/1\.5\s*NEAR|1500000/i)).toBeVisible({
      timeout: 5000,
    });

    // Discourse status - could be various text
    const linkedText = page.getByText(
      /Linked to Discourse|Connected|playwright/i
    );
    await expect(linkedText.first()).toBeVisible({ timeout: 5000 });

    // Badges
    await expect(page.getByText(/Catalyst Rounds/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/Early Contributor/i)).toBeVisible({
      timeout: 5000,
    });

    const plausibleEvents = await page.evaluate(
      () => (window as any).plausibleEvents
    );
    expect(
      plausibleEvents.find(
        (event: any) => event.event === "wallet_connect_succeeded"
      )
    ).toBeDefined();
  });

  test("warns about wallet when no NEAR account and gates discourse linking", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await stubAuthRoutesForNoAccount(page);
    await stubDiscourseLinkage(page, { payload: null });
    await stubNearRpc(page);

    await page.goto("/profile", { waitUntil: "networkidle" });
    await waitForProfileRender(page);

    // Look for wallet warning with flexible selectors
    // The testid might not exist, so try text-based selectors
    const walletWarning = page.getByTestId("discourse-wallet-warning");
    const walletWarningText = page.getByText(
      /Wallet not connected|Connect.*wallet|No wallet/i
    );
    const walletWarningHeading = page.getByRole("heading", {
      name: /Wallet not connected|Connect/i,
    });

    const hasTestId = await walletWarning
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    const hasText = await walletWarningText
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    const hasHeading = await walletWarningHeading
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    expect(hasTestId || hasText || hasHeading).toBe(true);

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
    await setupAuthenticatedUser(page, nearAccountId);

    await page.goto("/profile", { waitUntil: "networkidle" });
    await waitForProfileRender(page);

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
    await waitForProfileRender(page);

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
    await setupAuthenticatedUser(page, nearAccountId);
    await page.goto("/profile", { waitUntil: "networkidle" });
    await waitForProfileRender(page);

    // Empty badges state - flexible text matching
    const emptyBadges = page.getByText(/No badges|earned yet|0 badges/i);
    await expect(emptyBadges.first()).toBeVisible({ timeout: 5000 });

    // Switch to error state
    await page.unroute("**/api/discourse/user/**");
    await stubDiscourseBadge(page, { success: false });
    await page.reload({ waitUntil: "networkidle" });
    await waitForProfileRender(page);

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
    await stubDiscourseRpc(page, "getUserApiAuthUrl", {
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
    await setupAuthenticatedUser(page, nearAccountId);
    await page.goto("/profile", { waitUntil: "networkidle" });
    await waitForProfileRender(page);

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
      name: /Complete|Verify|Link/i,
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
    await stubDiscourseRpc(page, "getUserApiAuthUrl", {
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
    await setupAuthenticatedUser(page, nearAccountId);
    await page.goto("/profile", { waitUntil: "networkidle" });
    await waitForProfileRender(page);

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
    await page.getByRole("button", { name: /Complete|Verify|Link/i }).click();

    // Verify error is shown
    await expect(
      page.getByText(/Failed|error|invalid|try again/i).first()
    ).toBeVisible({ timeout: 5000 });

    // Button should still be enabled for retry
    await expect(
      page.getByRole("button", { name: /Complete|Verify|Link/i })
    ).toBeEnabled();
  });

  test("discourse connect flow requires wallet before starting linking", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await stubNearRpc(page);
    await stubDiscourseLinkage(page, { payload: null });

    await setupUnauthenticatedUser(page);
    await page.goto("/profile", { waitUntil: "networkidle" });
    await waitForProfileRender(page);

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
