import type { Page, Route } from "@playwright/test";
import proposalsFixture from "../../fixtures/playwright/proposals-latest.json";
import proposalDetailFixture from "../../fixtures/playwright/proposal-detail.json";
import replySummaryFixture from "../../fixtures/playwright/discourse-reply-summary.json";
import topicSummaryFixture from "../../fixtures/playwright/discourse-topic-summary.json";
import { markPageWithCustomAuthRoutes } from "./playwright-mocks";

type AuthSessionPayload = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  session: {
    id: string;
    token: string;
    expiresAt: string;
  };
};

type SetupAuthenticatedUserOptions = {
  accountId?: string;
  session?: AuthSessionPayload;
  linkedAccounts?: Array<Record<string, unknown>>;
  authenticatedSelectors?: string[];
};

const DEFAULT_ACCOUNT_ID = "playwright.testnet";

const DEFAULT_SESSION: AuthSessionPayload = {
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
};

const defaultAccounts = (accountId: string, userId: string) => [
  {
    id: "linked-playwright-1",
    providerId: "siwn",
    accountId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId,
    scopes: ["basic"],
  },
];

const defaultAuthSelectors = [
  "text=Connected wallet",
  "text=Sign In",
  "text=Disconnect Wallet",
];

const respondWithJson = (route: Route, payload: unknown, status = 200) => {
  route.fulfill({
    status,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
};

const waitForHarness = async (page: Page) => {
  await page.waitForFunction(
    () =>
      typeof window !== "undefined" &&
      typeof (window as any).__NEAR_TEST_HARNESS__ !== "undefined",
    { timeout: 10_000 }
  );
};

const waitForAnySelector = async (
  page: Page,
  selectors: string[],
  timeout = 3_000
) => {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout });
      return;
    } catch {
      // try next selector
    }
  }
  throw new Error(
    `setupAuthenticatedUser: none of the auth selectors became visible (${selectors.join(
      ", "
    )})`
  );
};

export const setupAuthenticatedUser = async (
  page: Page,
  options?: SetupAuthenticatedUserOptions
) => {
  const accountId = options?.accountId ?? DEFAULT_ACCOUNT_ID;
  const session = options?.session ?? DEFAULT_SESSION;
  const selectors = options?.authenticatedSelectors ?? defaultAuthSelectors;

  markPageWithCustomAuthRoutes(page);

  const accountsPayload =
    options?.linkedAccounts ??
    defaultAccounts(accountId, session.user.id ?? DEFAULT_SESSION.user.id);

  await page.route("**/api/auth/session", (route) => {
    respondWithJson(route, session);
  });
  await page.route("**/api/auth/list-accounts", (route) => {
    respondWithJson(route, { data: accountsPayload });
  });
  await page.route("**/api/auth/accounts", (route) => {
    respondWithJson(route, { data: accountsPayload });
  });

  await waitForHarness(page);

  await page.evaluate(
    ([account]) => {
      return (window as typeof window & {
        __NEAR_TEST_HARNESS__?: {
          emitSignIn?: (options?: { accountId?: string }) => Promise<void>;
        };
      }).__NEAR_TEST_HARNESS__?.emitSignIn?.({ accountId: account });
    },
    [accountId]
  );

  await waitForAnySelector(page, selectors);
};

type MockDiscourseOptions = {
  latest?: unknown;
  latestStatus?: number;
  topicSummaries?: Record<string, unknown>;
  replySummaries?: Record<string, unknown>;
  topicDetail?: unknown;
};

const extractTopicId = (url: string) => {
  const match = url.match(/\/topics\/(\d+)/);
  return match ? match[1] : null;
};

export const mockDiscourseAPI = async (
  page: Page,
  options?: MockDiscourseOptions
) => {
  const latestPayload = options?.latest ?? proposalsFixture;
  const latestStatus = options?.latestStatus ?? 200;

  await page.route(/\/api\/discourse\/latest/, (route) => {
    respondWithJson(route, latestPayload, latestStatus);
  });

  await page.route(/\/api\/discourse\/topics\/\d+\/summarize/, (route) => {
    const topicId = extractTopicId(route.request().url()) ?? "default";
    const payload =
      options?.topicSummaries?.[topicId] ?? topicSummaryFixture;
    respondWithJson(route, payload);
  });

  await page.route(/\/api\/discourse\/replies\/\d+\/summarize/, (route) => {
    const replyId = extractTopicId(route.request().url()) ?? "default";
    const payload =
      options?.replySummaries?.[replyId] ?? replySummaryFixture;
    respondWithJson(route, payload);
  });

  await page.route(/\/api\/discourse\/topics\/\d+$/, (route) => {
    const payload = options?.topicDetail ?? proposalDetailFixture;
    respondWithJson(route, payload);
  });
};

export const dismissPopups = async (page: Page) => {
  const popupSelectors = [
    ".hot-connector-popup",
    "[data-modal]",
    ".overlay",
    ".modal-backdrop",
  ];

  for (const selector of popupSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    const isVisible = await locator.isVisible().catch(() => false);
    if (!isVisible) {
      continue;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await locator.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
  }
};

export const waitForAppReady = async (page: Page) => {
  await page.waitForSelector("#__next", { timeout: 15_000 });
  await page.waitForFunction(() => document.readyState === "complete", {
    timeout: 15_000,
  });

  const loadingSelectors = [
    "[data-loading]",
    "[data-testid='loading']",
    ".loading-skeleton",
    ".skeleton",
    ".animate-pulse",
  ];

  for (const selector of loadingSelectors) {
    const loader = page.locator(selector);
    if ((await loader.count()) === 0) continue;
    await loader.waitFor({ state: "hidden", timeout: 4_000 }).catch(() => {});
  }

  await page.waitForTimeout(100);
};
