"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient, safeSignOut, useSession } from "@/lib/auth/auth-client";
import { siwnRecipient } from "@/config/siwn";
import { shouldRetryNonce } from "@/lib/auth/retry";
import { NearError, type Near } from "near-kit";

export interface ViewFunctionParams {
  contractId: string;
  method: string;
  args?: Record<string, unknown>;
}

export interface CallFunctionParams {
  contractId: string;
  method: string;
  args?: Record<string, unknown>;
  gas?: string;
  deposit?: string;
}

const getPlaywrightWalletAccount = () =>
  typeof window !== "undefined"
    ? (window as any).__PLAYWRIGHT_WALLET_ACCOUNT__ ?? null
    : null;

const isPlaywrightTest =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  (process.env.PLAYWRIGHT_TEST ?? "").toLowerCase() === "true";

function classifyNearError(err: unknown): {
  message: string;
  retryable: boolean;
  code?: string;
} {
  if (err instanceof NearError) {
    return {
      message: err.message,
      retryable: "retryable" in err ? Boolean(err.retryable) : false,
      code: err.code,
    };
  }

  return {
    message: err instanceof Error ? err.message : "Unknown error",
    retryable: false,
  };
}

export function useNear() {
  const { data: session, isPending, refetch: refetchSession } = useSession();

  const mockWalletAccount = getPlaywrightWalletAccount();
  const [nearClient, setNearClient] = useState<Near | null>(null);
  const [walletAccountId, setWalletAccountId] = useState<string>(
    mockWalletAccount ?? ""
  );
  const [isClientReady, setIsClientReady] = useState(false);
  const [clientInitKey, setClientInitKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const initializeClient = async () => {
      try {
        const client = authClient.near.getNearClient();
        const resolvedMock = getPlaywrightWalletAccount();
        const accountId = resolvedMock ?? authClient.near.getAccountId() ?? "";

        if (cancelled) {
          return;
        }

        setNearClient(client);
        setWalletAccountId(accountId);
        setIsClientReady(true);
      } catch (error) {
        console.error("Failed to initialize NEAR wallet client:", error);
        setIsClientReady(false);
      }
    };

    void initializeClient();

    return () => {
      cancelled = true;
    };
  }, [clientInitKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !isPlaywrightTest) {
      return;
    }

    const syncMockAccount = () => {
      const mockAccount = getPlaywrightWalletAccount();
      const normalized = mockAccount ?? "";
      setWalletAccountId((prev) => (prev === normalized ? prev : normalized));
    };

    syncMockAccount();
    const intervalId = window.setInterval(syncMockAccount, 250);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const getSafeNearClient = useCallback(() => {
    if (nearClient) {
      return nearClient;
    }

    try {
      return authClient.near.getNearClient();
    } catch (error) {
      console.error("NEAR client access failed:", error);
      return null;
    }
  }, [nearClient]);

  const signedAccountId = useMemo(() => {
    if (session?.user) {
      const nearAccount = (session.user as any).accounts?.find(
        (acc: any) => acc.providerId === "siwn"
      );
      if (nearAccount?.accountId) {
        return nearAccount.accountId.split(":")[0];
      }
    }
    return walletAccountId ?? "";
  }, [session, walletAccountId]);

  const signIn = useCallback(async () => {
    if (!getSafeNearClient()) {
      throw new Error("NEAR client not initialized");
    }

    let retriedNonce = false;

    while (true) {
      try {
        await authClient.requestSignIn.near({ recipient: siwnRecipient });
        await authClient.signIn.near({ recipient: siwnRecipient });

        const accountId = authClient.near.getAccountId() ?? "";
        setWalletAccountId(accountId);

        if (refetchSession) {
          try {
            await refetchSession();
          } catch (error) {
            console.error("Failed to refresh session after NEAR sign-in:", error);
          }
        }

        return accountId;
      } catch (error) {
        if (!retriedNonce && shouldRetryNonce(error)) {
          retriedNonce = true;
          continue;
        }

        setWalletAccountId("");
        throw error;
      }
    }
  }, [getSafeNearClient, refetchSession]);

  const signOut = useCallback(async () => {
    try {
      await safeSignOut();
      if (refetchSession) {
        try {
          await refetchSession();
        } catch (refetchError) {
          console.error("Failed to refresh session after NEAR sign-out:", refetchError);
        }
      }
    } catch (error) {
      console.error("Safe sign-out failed:", error);
    } finally {
      setWalletAccountId("");
      setNearClient(null);
      setIsClientReady(false);
      setClientInitKey((prev) => prev + 1);
    }
  }, [refetchSession]);

  const viewFunction = useCallback(
    async <T = unknown,>({
      contractId,
      method,
      args = {},
    }: ViewFunctionParams): Promise<T> => {
      const client = getSafeNearClient();
      if (!client) {
        throw new Error("NEAR client not initialized");
      }

      try {
        return (await client.view(contractId, method, args)) as T;
      } catch (err) {
        const classified = classifyNearError(err);
        console.error(`[useNear] viewFunction failed:`, {
          contractId,
          method,
          ...classified,
        });
        throw err;
      }
    },
    [getSafeNearClient]
  );

  const callFunction = useCallback(
    async ({
      contractId,
      method,
      args = {},
      gas = "30 Tgas",
      deposit = "0",
    }: CallFunctionParams) => {
      const client = getSafeNearClient();
      if (!client) {
        throw new Error("NEAR client not initialized");
      }

      try {
        return client.call(contractId, method, args, {
          gas,
          attachedDeposit: deposit,
        });
      } catch (err) {
        const classified = classifyNearError(err);
        console.error(`[useNear] callFunction failed:`, {
          contractId,
          method,
          ...classified,
        });
        throw err;
      }
    },
    [getSafeNearClient]
  );

  return {
    signedAccountId,
    walletAccountId,
    isAuthenticated: !!session?.user,
    signIn,
    signOut,
    loading: isPending || !isClientReady,
    viewFunction,
    callFunction,
    nearClient,
    session,
  };
}

export { classifyNearError };
export type { NearError };
