import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  markPageWithCustomAuthRoutes,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import { setupAuthenticatedUser, setupUnauthenticatedUser } from "./helpers/setup";

const { describe: describeSpec } = createPlaywrightGuard("profile.spec.ts");

const nearAccountId = "playwright.testnet";

const nearRpcUrl = "https://test.rpc.fastnear.com";

const respondOrpc = (payload: unknown) =>
  JSON.stringify({ json: payload });

const ensurePlausibleSpy = async (page: Page) => {
  await page.addInitScript(() => {
    (window as typeof window & { plausible?: (...args: any[]) => void }).plausible =
      ((window as any).plausible ?? (() => undefined)) as () => void;
    (window as any).plausibleEvents = [];
    const original = (window as any).plausible;
    (window as any).plausible = (event: string, opts?: { props?: Record<string, unknown> }) => {
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

const stubDiscourseRpc = async (page: Page, method: string, payload: unknown, status = 200) => {
  await page.route(`**/api/rpc/discourse/${method}`, (route) => {
    route.fulfill({
      status,
      headers: { "Content-Type": "application/json" },
      body: respondOrpc(payload),
    });
  });
};

const openProfileFromNav = async (page: Page) => {
  const accountButton = page.locator("button", {
    hasText: nearAccountId,
  });
  await expect(accountButton).toBeVisible();
  await accountButton.first().click();
  const profileMenu = page
    .locator("nextjs-portal")
    .filter({ hasText: /My Account/i })
    .first();
  await expect(profileMenu).toBeVisible();
  const profileItem = profileMenu.getByRole("menuitem", { name: /Profile/i });
  await expect(profileItem).toBeVisible();
  await profileItem.click();
};

describeSpec("Profile journeys", () => {
  test("shows skeleton, linked summary, NEAR balance, wallet status and badges", async ({
    page,
  }) => {
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
    await openProfileFromNav(page);

    const skeleton = page.locator(".animate-pulse").first();
    await expect(skeleton).toBeVisible();
    await expect(page.getByText(/NEAR Balance/i)).toBeVisible();
    await expect(page.getByText(/1\.5\s+NEAR/i)).toBeVisible();
    await expect(page.getByText(/Linked to Discourse/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /View Profile/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Unlink/i })).toBeVisible();
    await expect(page.getByText(/Catalyst Rounds/i)).toBeVisible();
    await expect(page.getByText(/Early Contributor/i)).toBeVisible();

    const plausibleEvents = await page.evaluate(() => (window as any).plausibleEvents);
    expect(plausibleEvents.find((event: any) => event.event === "wallet_connect_succeeded")).toBeDefined();
  });

  test("warns about wallet when no NEAR account and gates discourse linking", async ({ page }) => {
    registerPlaywrightMocks(page);
    await stubAuthRoutesForNoAccount(page);
    await stubDiscourseLinkage(page, { payload: null });
    await stubNearRpc(page);

    await page.goto("/profile", { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").textContent();
    console.log("Profile page contains:", bodyText?.substring(0, 500));

    await expect(
      page.getByText(/Connect your NEAR wallet to Discourse/i)
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Wallet not connected" })
    ).toBeVisible();

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
    await expect(
      page.getByRole("heading", { name: new RegExp(nearAccountId, "i") })
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Plugin Unavailable" })
    ).toBeVisible();
    await expect(
      page.getByText("Discourse plugin server is not running.", {
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByText(/cd discourse-plugin && bun run dev/)).toBeVisible();

    await page.reload();
    await page.unroute("**/api/rpc/discourse/getLinkage");
    await stubDiscourseLinkage(page, {
      payload: {
        discourseUsername: "playwright",
        userApiKey: "api-key",
      },
    });
    await page.unroute("**/api/discourse/user/**");
    await stubDiscourseBadge(page, { success: true, badges: [] });

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Connect to Discourse" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Unlink/i })).toBeVisible();
    await page.getByRole("button", { name: /Unlink/i }).click();
    await expect(
      page.getByRole("button", { name: "Connect to Discourse" })
    ).toBeVisible();
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
    await expect(
      page.getByText("No badges earned yet.", { exact: true })
    ).toBeVisible();

    await page.unroute("**/api/discourse/user/**");
    await stubDiscourseBadge(page, { success: false });
    await page.reload();
    await expect(page.getByText(/Unable to load badges right now./i)).toBeVisible();
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
    await expect(
      page.getByRole("heading", { name: new RegExp(nearAccountId, "i") })
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Connect to Discourse" }).first()
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Connect to Discourse" })
      .click();
    await page.getByRole("button", { name: /Paste from clipboard/i }).click();
    await page.fill("#discourse-key", "mock-api-key");
    await page.getByRole("button", { name: /Complete Link/i }).click();

    await expect(page.getByText(/Linked to Discourse/i)).toBeVisible();
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
    await expect(
      page.getByRole("heading", { name: new RegExp(nearAccountId, "i") })
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Connect to Discourse" })
      .click();
    await page.fill("#discourse-key", "broken-key");
    await page.getByRole("button", { name: /Complete Link/i }).click();

    await expect(page.getByText(/Failed to complete link\. Please try again\./i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Complete Link/i })).toBeEnabled();
  });

  test("discourse connect flow requires wallet before starting linking", async ({ page }) => {
    registerPlaywrightMocks(page);
    await stubNearRpc(page);
    await stubDiscourseLinkage(page, { payload: null });

    await setupUnauthenticatedUser(page);
    await page.goto("/profile", { waitUntil: "networkidle" });

    await expect(
      page.getByRole("heading", { name: /Wallet not connected/i })
    ).toBeVisible();
    await expect(
      page.getByText(/Connect your NEAR wallet to Discourse/i)
    ).toBeVisible();

    const connectButton = page.getByRole("button", {
      name: "Connect to Discourse",
    });
    await expect(connectButton).toHaveCount(0);
  });
});
