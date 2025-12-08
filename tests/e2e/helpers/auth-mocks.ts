import { randomUUID } from "crypto";
import type { Page, Route } from "@playwright/test";

import { markPageWithCustomAuthRoutes } from "./playwright-mocks";

const DEFAULT_ACCOUNT_ID = "playwright.near:mainnet";
const DEFAULT_NONCE = "playwright-test-nonce";

const respondWithJson = (route: Route, payload: unknown, status = 200) => {
  route.fulfill({
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

const randomId = () =>
  typeof randomUUID === "function"
    ? randomUUID()
    : `mock-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

type AuthSessionPayload = {
  session: {
    id: string;
    userId: string;
    expiresAt: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
    accounts: Array<{ providerId: string; accountId: string }>;
  };
};

type LinkedAccountRecord = {
  id: string;
  providerId: "siwn";
  accountId: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  scopes: string[];
};

const createLinkedAccountRecord = (
  accountId: string,
  userId?: string
): LinkedAccountRecord => ({
  id: `linked-${randomId()}`,
  providerId: "siwn",
  accountId,
  userId: userId ?? null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  scopes: ["basic"],
});

const buildAuthSessionPayload = (
  accountId: string
): AuthSessionPayload & { linkedAccounts: LinkedAccountRecord[] } => {
  const userId = `user-${randomId()}`;
  const session = {
    id: `session-${randomId()}`,
    userId,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
  const user = {
    id: userId,
    name: "Playwright NEAR User",
    email: "playwright@near.org",
    accounts: [{ providerId: "siwn", accountId }],
  };
  return {
    session,
    user,
    linkedAccounts: [createLinkedAccountRecord(accountId, userId)],
  };
};

const markCustomAuthRoutes = (page: Page) => {
  markPageWithCustomAuthRoutes(page);
};

export const mockAuthenticatedSession = async (
  page: Page,
  accountId = DEFAULT_ACCOUNT_ID
) => {
  const { session, user, linkedAccounts } = buildAuthSessionPayload(accountId);
  markCustomAuthRoutes(page);

  await page.route("**/api/auth/get-session", (route) => {
    respondWithJson(route, { session, user });
  });
  await page.route("**/api/auth/list-accounts", (route) => {
    respondWithJson(route, { data: linkedAccounts });
  });
  await page.route("**/api/auth/accounts", (route) => {
    respondWithJson(route, { data: linkedAccounts });
  });
};

export const mockUnauthenticatedSession = async (page: Page) => {
  markCustomAuthRoutes(page);

  await page.route("**/api/auth/get-session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });
};

export const mockWalletConnected = async (
  page: Page,
  accountId = DEFAULT_ACCOUNT_ID
) => {
  await page.addInitScript((id: string) => {
    (window as any).__PLAYWRIGHT_WALLET_ACCOUNT__ = id;
  }, accountId);
  const linkedAccounts = [createLinkedAccountRecord(accountId)];
  markCustomAuthRoutes(page);

  await page.route("**/api/auth/get-session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });
  await page.route("**/api/auth/list-accounts", (route) => {
    respondWithJson(route, { data: linkedAccounts });
  });
  await page.route("**/api/auth/accounts", (route) => {
    respondWithJson(route, { data: linkedAccounts });
  });
};

export const mockSignInSuccess = async (page: Page) => {
  markCustomAuthRoutes(page);

  await page.route("**/api/auth/near/verify", (route) => {
    respondWithJson(route, { ok: true });
  });
};

export const mockSignInFailure = async (
  page: Page,
  error: string = "Mock sign-in failure"
) => {
  markCustomAuthRoutes(page);

  await page.route("**/api/auth/near/verify", (route) => {
    respondWithJson(route, { ok: false, error }, 400);
  });
};

export const mockNonceRequest = async (page: Page, nonce = DEFAULT_NONCE) => {
  markCustomAuthRoutes(page);

  await page.route("**/api/auth/near/nonce", (route) => {
    respondWithJson(route, { nonce });
  });
};
