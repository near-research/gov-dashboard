import {
  isUserRejected,
  shouldRetryNonce,
  waitForBackoff,
} from "@/lib/auth/retry";

export type NearSignInResult =
  | { status: "success" }
  | { status: "cancelled"; message: string }
  | { status: "network-mismatch"; message: string }
  | { status: "error"; message: string; error?: any };

type SignInAttempt = () => Promise<void>;

type Options = {
  walletAccountId?: string | null;
  connectWallet: () => Promise<void>;
  requestSignIn: SignInAttempt;
  signIn: SignInAttempt;
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
}: Options): Promise<NearSignInResult> {
  const ensureWallet = async () => {
    if (!walletAccountId) {
      await connectWallet();
    }
  };

  try {
    await ensureWallet();
  } catch (err: any) {
    if (isUserRejected(err)) {
      return { status: "cancelled", message: "Wallet connection cancelled" };
    }
    return {
      status: "error",
      message: err?.message || "Failed to connect wallet",
      error: err,
    };
  }

  const attemptOnce = async () => {
    await requestSignIn();
    await signIn();
  };

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await attemptOnce();
      return { status: "success" };
    } catch (err: any) {
      lastError = err;

      if (isUserRejected(err)) {
        return { status: "cancelled", message: "Wallet connection cancelled" };
      }

      if (err?.code === "NETWORK_MISMATCH") {
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
    await disconnectOnError().catch(() => {
      // Swallow disconnect errors; main failure already captured.
    });
  }

  return {
    status: "error",
    message: lastError?.message || "Authentication failed",
    error: lastError,
  };
}
