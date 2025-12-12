import type { Page, Route } from "@playwright/test";
import { randomUUID } from "crypto";
import { markPageWithCustomAuthRoutes } from "./playwright-mocks";

const DEFAULT_ACCOUNT_ID = "playwright.near:mainnet";
const DEFAULT_TOKEN = "mock-session-token";

const respondWithJson = (route: Route, payload: unknown, status = 200) => {
  route.fulfill({
    status,
    headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  });
};

const getNetwork = (accountId: string): "mainnet" | "testnet" =>
  accountId.endsWith(".testnet") ? "testnet" : "mainnet";

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
  linkedAccounts: Array<{
    id: string;
    providerId: "siwn";
    accountId: string;
    userId: string;
    createdAt: string;
    updatedAt: string;
    scopes: string[];
  }>;
};

type NonceStep = {
  nonce: string;
  accountId: string;
  network: "mainnet" | "testnet";
};

const createLinkedAccountRecord = (
  accountId: string,
  userId: string
) => ({
  id: `linked-${randomUUID()}`,
  providerId: "siwn" as const,
  accountId,
  userId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  scopes: ["basic"],
});

const clearAuthRoutes = (page: Page, patterns: string[]) => {
  for (const pattern of patterns) {
    page.unroute(pattern);
  }
};

const buildSessionPayload = (
  accountId: string
): AuthSessionPayload & { network: "mainnet" | "testnet" } => {
  const network = getNetwork(accountId);
  const userId = `user-${randomUUID()}`;
  const session = {
    id: `session-${randomUUID()}`,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const user = {
    id: userId,
    name: "Playwright NEAR User",
    email: `${accountId.replace(/\./g, "-")}@near.org`,
    accounts: [{ providerId: "siwn", accountId }],
  };
  const linkedAccounts = [
    createLinkedAccountRecord(accountId, userId),
  ];
  return { session, user, linkedAccounts, network };
};

const setPlaywrightWalletAccount = async (
  page: Page,
  accountId: string | null
) => {
  await page.addInitScript((value: string | null) => {
    (window as any).__PLAYWRIGHT_WALLET_ACCOUNT__ = value;
  }, accountId);

  await page.evaluate(
    (value: string | null) => {
      (window as any).__PLAYWRIGHT_WALLET_ACCOUNT__ = value;
    },
    accountId
  );
};

export const mockRequestSignIn = async (
  page: Page,
  accountId: string = DEFAULT_ACCOUNT_ID
): Promise<NonceStep> => {
  const { network } = buildSessionPayload(accountId);
  const nonce = Buffer.from(randomUUID()).toString("base64");

  await setPlaywrightWalletAccount(page, accountId);

  markPageWithCustomAuthRoutes(page);

  clearAuthRoutes(page, [
    "**/api/auth/near/nonce",
    "**/api/auth/get-session",
    "**/api/auth/session",
  ]);

  await page.route("**/api/auth/near/nonce", (route) => {
    respondWithJson(route, { nonce });
  });
  await page.route("**/api/auth/session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });
  await page.route("**/api/auth/get-session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });

  return { nonce, accountId, network };
};

export const mockCompleteSignIn = async (
  page: Page,
  accountId: string = DEFAULT_ACCOUNT_ID
) => {
  await setPlaywrightWalletAccount(page, accountId);

  const { session, user, linkedAccounts, network } =
    buildSessionPayload(accountId);
  markPageWithCustomAuthRoutes(page);

  clearAuthRoutes(page, [
    "**/api/auth/near/verify",
    "**/api/auth/get-session",
    "**/api/auth/session",
    "**/api/auth/list-accounts",
    "**/api/auth/accounts",
  ]);

  await page.route("**/api/auth/near/verify", (route) => {
    respondWithJson(route, {
      token: DEFAULT_TOKEN,
      success: true,
      user: { id: user.id, accountId, network },
    });
  });

  await page.route("**/api/auth/get-session", (route) => {
    respondWithJson(route, { session, user, linkedAccounts });
  });

  await page.route("**/api/auth/list-accounts", (route) => {
    respondWithJson(route, { data: linkedAccounts });
  });

  await page.route("**/api/auth/accounts", (route) => {
    respondWithJson(route, { data: linkedAccounts });
  });

  await page.route("**/api/auth/session", (route) => {
    respondWithJson(route, { session, user, linkedAccounts });
  });

  return { session, user, linkedAccounts };
};

export const mockAuthenticatedSession = async (
  page: Page,
  accountId: string = DEFAULT_ACCOUNT_ID
) => {
  await mockCompleteSignIn(page, accountId);
};

export const mockUnauthenticatedSession = async (page: Page) => {
  await setPlaywrightWalletAccount(page, null);
  markPageWithCustomAuthRoutes(page);
  clearAuthRoutes(page, [
    "**/api/auth/get-session",
    "**/api/auth/list-accounts",
    "**/api/auth/accounts",
    "**/api/auth/near/verify",
    "**/api/auth/near/nonce",
    "**/api/auth/session",
  ]);
  await page.route("**/api/auth/get-session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });

  await page.route("**/api/auth/session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });
};

export const mockWalletConnected = async (
  page: Page,
  accountId: string = DEFAULT_ACCOUNT_ID
) => {
  await setPlaywrightWalletAccount(page, accountId);
  markPageWithCustomAuthRoutes(page);
  clearAuthRoutes(page, [
    "**/api/auth/get-session",
    "**/api/auth/list-accounts",
    "**/api/auth/accounts",
    "**/api/auth/session",
  ]);
  const linkedAccount = createLinkedAccountRecord(accountId, "wallet-only");

  await page.route("**/api/auth/get-session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });
  await page.route("**/api/auth/list-accounts", (route) => {
    respondWithJson(route, { data: [linkedAccount] });
  });
  await page.route("**/api/auth/accounts", (route) => {
    respondWithJson(route, { data: [linkedAccount] });
  });

  await page.route("**/api/auth/session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });

  return linkedAccount;
};

export const mockSignInFailure = async (
  page: Page,
  message: string,
  code = "UNAUTHORIZED"
) => {
  markPageWithCustomAuthRoutes(page);
  clearAuthRoutes(page, [
    "**/api/auth/near/verify",
    "**/api/auth/session",
  ]);
  await page.route("**/api/auth/near/verify", (route) => {
    respondWithJson(route, { error: { message, code } }, 400);
  });
  await page.route("**/api/auth/session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });
};

export const mockNonceRetry = async (page: Page) => {
  let attempt = 0;
  markPageWithCustomAuthRoutes(page);
  clearAuthRoutes(page, ["**/api/auth/near/verify", "**/api/auth/session"]);

  await page.route("**/api/auth/near/verify", (route) => {
    attempt += 1;
    if (attempt === 1) {
      respondWithJson(
        route,
        { error: { message: "Nonce expired", code: "NONCE_NOT_FOUND" } },
        400
      );
      return;
    }
    respondWithJson(route, {
      token: "retry-session",
      success: true,
      user: { id: "user-1", accountId: "test.near", network: "mainnet" },
    });
  });

  await page.route("**/api/auth/session", (route) => {
    respondWithJson(route, { session: null, user: null });
  });

  return { getAttemptCount: () => attempt };
};
