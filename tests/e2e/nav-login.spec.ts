import { expect, test, type Page } from "@playwright/test";
import {
  markPageWithCustomAuthRoutes,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";

const { describe: describeSpec } = createPlaywrightGuard("nav-login.spec.ts");

type AuthSessionPayload =
  | {
      user: null;
      session: null;
    }
  | {
      user: { id: string; email: string; name: string };
      session: { id: string; token: string; expiresAt: string };
    };

type PlausibleEvent = {
  event: string;
  props: Record<string, unknown> | null;
};

const createAnonymousSession = (): AuthSessionPayload => ({
  user: null,
  session: null,
});

const createAuthenticatedSession = (): AuthSessionPayload => ({
  user: {
    id: "playwright-user",
    email: "playwright@near.org",
    name: "Playwright Tester",
  },
  session: {
    id: "session-1",
    token: "token-123",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
});

const waitForWalletHarness = (page: Page) =>
  page.waitForFunction(
    () =>
      typeof window !== "undefined" && !!(window as typeof window & { __NEAR_TEST_HARNESS__?: unknown }).__NEAR_TEST_HARNESS__
  );

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const setupAnalyticsCapture = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__capturedGovernanceEvents = [];
    const original = (window as any).__plausible;
    (window as any).__plausible = (
      event: string,
      options?: { props?: Record<string, unknown> }
    ) => {
      (window as any).__capturedGovernanceEvents.push({
        event,
        props: options?.props ?? null,
      });
      return original?.call(window, event, options);
    };
  });
  return async (): Promise<PlausibleEvent[]> => {
    const captured = await page.evaluate(() => {
      return (window as any).__capturedGovernanceEvents ?? [];
    });
    return captured as PlausibleEvent[];
  };
};

const setupAuthSessionRoutes = async (page: Page) => {
  let payload: AuthSessionPayload = createAnonymousSession();
  markPageWithCustomAuthRoutes(page);
  const setAuthenticated = () => {
    payload = createAuthenticatedSession();
  };
  const setAnonymous = () => {
    payload = createAnonymousSession();
  };

  await page.route("**/api/auth/session", (route) => {
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  await page.route("**/api/auth/sign-out", async (route) => {
    setAnonymous();
    await route.continue();
  });

  return { setAuthenticated, setAnonymous };
};

const closeHotConnectorPopup = async (page: Page) => {
  const popup = page.locator(".hot-connector-popup");
  if ((await popup.count()) === 0) {
    return;
  }

  if (!(await popup.first().isVisible())) {
    return;
  }

  await page.keyboard.press("Escape");
  await popup.first().waitFor({ state: "hidden" });
};

const mockDiscourseLinkage = async (page: Page) => {
  await page.route("**/api/rpc/discourse/getLinkage", (route) => {
    const body = route.request().postData();
    let nearAccount = "playwright.near";
    if (body) {
      try {
        const parsed = JSON.parse(body);
        nearAccount = parsed.json?.nearAccount ?? nearAccount;
      } catch {
        /* ignore malformed request */
      }
    }

    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: {
          nearAccount,
          discourseUsername: "playwright-discourse",
        },
        meta: [],
      }),
    });
  });
};

describeSpec("Navigation & Login journey (NEAR + Better Auth + Discourse)", () => {
  test("home nav blends the NEAR wallet, Better Auth session, and Discourse linkage while tracking Plausible events", async ({
    page,
  }) => {
    const { setAuthenticated } = await setupAuthSessionRoutes(page);
    const readEvents = await setupAnalyticsCapture(page);
    await registerPlaywrightMocks(page);
    await mockDiscourseLinkage(page);

    await page.route("**/near/nonce", (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { nonce: `nonce-${Date.now()}` },
        }),
      });
    });

    await page.route("**/near/verify", async (route) => {
      await delay(250);
      setAuthenticated();
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { success: true },
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const nav = page.locator("nav");
    await expect(nav).toBeVisible();
    await expect(nav).toHaveClass(/sticky/);

    const logo = nav.locator("img[alt='NEAR']");
    await expect(logo).toBeVisible();
    await expect(logo.locator("..")).toHaveAttribute("href", "/");

    const draftButton = page.getByRole("button", { name: /Draft/i });
    await expect(draftButton).toBeVisible();
    await draftButton.click();
    await expect(page).toHaveURL(/\/proposals\/new$/);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const connectButton = page.getByRole("button", { name: /Connect Wallet/i });
    await expect(connectButton).toBeVisible();

    const profileMenuItem = page.getByRole("menuitem", { name: /Profile/i });
    await expect(profileMenuItem).toHaveCount(0);

    await waitForWalletHarness(page);
    await connectButton.click();
    await page.evaluate(() => {
      (window as typeof window & { __NEAR_TEST_HARNESS__?: { emitSignIn?: () => Promise<void> } }).__NEAR_TEST_HARNESS__?.emitSignIn?.({ accountId: "playwright.near" });
    });

    const signInButton = page.locator("nav button").filter({ hasText: /Sign In/i }).first();
    await expect(signInButton).toBeVisible();
    await signInButton.click();

    const spinner = page.locator("nav svg.animate-spin");
    await expect(spinner).toBeVisible();
    await expect(spinner).not.toBeVisible();

    const accountButton = page.getByRole("button", { name: /playwright\.near/i }).first();
    await expect(accountButton).toBeVisible();
    await accountButton.click();

    const dropdown = page.locator("[role='menu']");
    await expect(dropdown).toBeVisible();

    const discourseIndicator = page.locator("[title='Discourse Connected']");
    await expect(discourseIndicator).toBeVisible();

    await expect(profileMenuItem).toBeVisible();
    const signOutItem = page.getByRole("menuitem", { name: /Sign Out/i });
    await expect(signOutItem).toBeVisible();

    await signOutItem.click();
    await expect(connectButton).toBeVisible();

    const events = await readEvents();
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toContain("wallet_connect_clicked");
    expect(eventNames).toContain("wallet_connect_succeeded");
    expect(eventNames).toContain("wallet_disconnect_clicked");
  });

  test("login page handles wallet rejection, retries nonce errors, and redirects home after Better Auth sign-in", async ({
    page,
  }) => {
    const { setAuthenticated } = await setupAuthSessionRoutes(page);
    const readEvents = await setupAnalyticsCapture(page);
    await registerPlaywrightMocks(page);
    await mockDiscourseLinkage(page);

    await page.route("**/near/nonce", (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { nonce: `nonce-${Date.now()}` },
        }),
      });
    });

    let verifyAttempt = 0;
    await page.route("**/near/verify", async (route) => {
      verifyAttempt += 1;
      if (verifyAttempt === 1) {
        route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: { message: "Nonce missing", code: "NONCE_NOT_FOUND" },
          }),
        });
        return;
      }

      await delay(200);
      setAuthenticated();
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { success: true },
        }),
      });
    });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Sign in to Continue/i })).toBeVisible();
    await expect(page.getByText("Connect your NEAR wallet")).toBeVisible();

    await waitForWalletHarness(page);
    await page.evaluate(() => {
      (window as typeof window & { __NEAR_TEST_HARNESS__?: { rejectConnection?: boolean } }).__NEAR_TEST_HARNESS__!.rejectConnection = true;
    });

    const connectButton = page.getByRole("button", { name: /Connect HOT Wallet/i });
    await connectButton.click();
    await expect(page.getByText(/Wallet connection cancelled/i)).toBeVisible();

    await page.evaluate(() => {
      (window as typeof window & { __NEAR_TEST_HARNESS__?: { rejectConnection?: boolean } }).__NEAR_TEST_HARNESS__!.rejectConnection = false;
    });

    await connectButton.click();
    await page.evaluate(() => {
      (window as typeof window & { __NEAR_TEST_HARNESS__?: { emitSignIn?: () => Promise<void> } }).__NEAR_TEST_HARNESS__?.emitSignIn?.({ accountId: "playwright.near" });
    });
    await expect(page.getByText(/Connected wallet/i)).toBeVisible();

    const disconnectButton = page.getByRole("button", { name: /Disconnect Wallet/i });
    await closeHotConnectorPopup(page);
    await disconnectButton.click();
    await expect(connectButton).toBeVisible();

    await connectButton.click();
    await page.evaluate(() => {
      (window as typeof window & { __NEAR_TEST_HARNESS__?: { emitSignIn?: () => Promise<void> } }).__NEAR_TEST_HARNESS__?.emitSignIn?.({ accountId: "playwright.near" });
    });
    await expect(page.getByText(/Connected wallet/i)).toBeVisible();

    const signInButton = page.getByRole("button", { name: /Sign In with HOT Wallet/i });
    await closeHotConnectorPopup(page);
    await signInButton.click();

    await page.waitForURL(/\/$/);
    expect(verifyAttempt).toBeGreaterThanOrEqual(2);

    const events = await readEvents();
    expect(events.some((event) => event.event === "wallet_connect_clicked")).toBe(true);
    expect(events.some((event) => event.event === "wallet_connect_succeeded")).toBe(true);
  });
});
