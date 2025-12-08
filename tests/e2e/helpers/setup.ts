import type { Page, Route } from "@playwright/test";
import proposalsFixture from "../../fixtures/playwright/proposals-latest.json";
import proposalDetailFixture from "../../fixtures/playwright/proposal-detail.json";
import replySummaryFixture from "../../fixtures/playwright/discourse-reply-summary.json";
import topicSummaryFixture from "../../fixtures/playwright/discourse-topic-summary.json";
import {
  mockAuthenticatedSession,
  mockSignInFailure,
  mockUnauthenticatedSession,
  mockWalletConnected,
} from "./auth-mocks";

const respondWithJson = (route: Route, payload: unknown, status = 200) => {
  route.fulfill({
    status,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
};

const navigateHome = async (page: Page) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
};

export const setupAuthenticatedUser = async (
  page: Page,
  accountId?: string
) => {
  await mockAuthenticatedSession(page, accountId);
  await navigateHome(page);
};

export const setupUnauthenticatedUser = async (page: Page) => {
  await mockUnauthenticatedSession(page);
  await navigateHome(page);
};

export const setupWalletRejection = async (
  page: Page,
  accountId?: string
) => {
  await mockWalletConnected(page, accountId);
  await mockSignInFailure(page, "Wallet connection cancelled by user");
  await navigateHome(page);
};

export const setupNonceError = async (page: Page) => {
  await mockUnauthenticatedSession(page);

  let attempt = 0;
  await page.route("**/api/auth/near/nonce", (route) => {
    attempt += 1;
    if (attempt === 1) {
      route.fulfill({
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: "NONCE_NOT_FOUND",
          message: "Mock nonce error",
        }),
      });
      return;
    }
    respondWithJson(route, { nonce: "retry-nonce-1" });
  });

  await navigateHome(page);
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
