import { authClient, disconnectNear, getAccountId } from "./auth-client";
import { siwnRecipient } from "@/config/siwn";
import { isUserRejected, shouldRetryNonce, waitForBackoff } from "./retry";

export type NearSignInResult =
  | { status: "success" }
  | { status: "cancelled"; message: string }
  | { status: "network-mismatch"; message: string }
  | { status: "error"; message: string; error?: unknown };

type Options = {
  recipient?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  onWalletConnected?: (accountId: string) => void;
};

export async function nearSignIn({
  recipient = siwnRecipient,
  maxRetries = 1,
  retryBaseDelayMs = 250,
  onWalletConnected,
}: Options = {}): Promise<NearSignInResult> {
  // Step 1: Connect wallet if not connected
  let accountId = getAccountId();

  if (!accountId) {
    try {
      await authClient.requestSignIn.near({ recipient });
      accountId = getAccountId();

      if (!accountId) {
        return { status: "error", message: "Failed to connect wallet" };
      }

      onWalletConnected?.(accountId);
    } catch (err: unknown) {
      if (isUserRejected(err)) {
        return { status: "cancelled", message: "Wallet connection cancelled" };
      }
      return {
        status: "error",
        message:
          err instanceof Error ? err.message : "Failed to connect wallet",
        error: err,
      };
    }
  }

  // Step 2: Sign in with retry logic
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Request fresh nonce if retrying
      if (attempt > 0) {
        await authClient.requestSignIn.near({ recipient });
      }

      await authClient.signIn.near({ recipient });
      return { status: "success" };
    } catch (err: unknown) {
      lastError = err;

      if (isUserRejected(err)) {
        return { status: "cancelled", message: "Sign-in cancelled" };
      }

      const errorWithCode = err as { code?: string };
      if (errorWithCode?.code === "NETWORK_MISMATCH") {
        return {
          status: "network-mismatch",
          message: "Connected wallet is on a different network.",
        };
      }

      if (shouldRetryNonce(err) && attempt < maxRetries) {
        if (retryBaseDelayMs > 0) {
          await waitForBackoff(attempt, retryBaseDelayMs);
        }
        continue;
      }

      break;
    }
  }

  // Cleanup on failure
  await disconnectNear().catch(() => {});

  return {
    status: "error",
    message:
      lastError instanceof Error ? lastError.message : "Authentication failed",
    error: lastError,
  };
}

export type NearSignInWithRetryOptions = {
  walletAccountId: string | null;
  connectWallet: () => Promise<void>;
  requestSignIn: () => Promise<void>;
  signIn: () => Promise<void>;
  disconnectOnError?: () => Promise<void>;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

export async function nearSignInWithRetry({
  walletAccountId,
  connectWallet,
  requestSignIn,
  signIn,
  disconnectOnError,
  maxRetries = 1,
  retryBaseDelayMs = 250,
}: NearSignInWithRetryOptions): Promise<NearSignInResult> {
  if (!walletAccountId) {
    try {
      await connectWallet();
    } catch (err: unknown) {
      if (isUserRejected(err)) {
        return { status: "cancelled", message: "Wallet connection cancelled" };
      }
      return {
        status: "error",
        message:
          err instanceof Error ? err.message : "Failed to connect wallet",
        error: err,
      };
    }
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await requestSignIn();
      await signIn();
      return { status: "success" };
    } catch (err: unknown) {
      lastError = err;

      if (isUserRejected(err)) {
        return { status: "cancelled", message: "Wallet connection cancelled" };
      }

      const errorWithCode = err as { code?: string };
      if (errorWithCode?.code === "NETWORK_MISMATCH") {
        return {
          status: "network-mismatch",
          message: "Connected wallet is on a different network.",
        };
      }

      if (shouldRetryNonce(err) && attempt < maxRetries) {
        if (retryBaseDelayMs > 0) {
          await waitForBackoff(attempt, retryBaseDelayMs);
        }
        continue;
      }

      break;
    }
  }

  if (disconnectOnError) {
    try {
      await disconnectOnError();
    } catch {
      // ignore disconnection errors
    }
  }

  return {
    status: "error",
    message:
      lastError instanceof Error ? lastError.message : "Authentication failed",
    error: lastError,
  };
}
