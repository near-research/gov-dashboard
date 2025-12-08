"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient, useSession } from "@/lib/auth/auth-client";
import { ensureHotLabsWalletIframeReady } from "@/lib/auth/ensure-iframe-ready";
import { siwnRecipient } from "@/config/siwn";
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
  const {
    data: session,
    isPending,
    refetch: refetchSession,
  } = useSession();

  const mockWalletAccount =
    typeof window !== "undefined"
      ? (window as any).__PLAYWRIGHT_WALLET_ACCOUNT__
      : null;
  const [nearClient, setNearClient] = useState<Near | null>(null);
  const [walletAccountId, setWalletAccountId] = useState<string>(
    mockWalletAccount ?? ""
  );
  const [isClientReady, setIsClientReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initializeClient = async () => {
      await ensureHotLabsWalletIframeReady();

      try {
        const client = authClient.near.getNearClient();
        const resolvedMock =
          typeof window !== "undefined"
            ? (window as any).__PLAYWRIGHT_WALLET_ACCOUNT__
            : null;
        const accountId =
          resolvedMock ?? authClient.near.getAccountId() ?? "";

        if (cancelled) {
          return;
        }

        setNearClient(client);
        setWalletAccountId(accountId);
        setIsClientReady(true);
      } catch (error) {
        console.error("Failed to initialize NEAR wallet client:", error);
      }
    };

    void initializeClient();

    return () => {
      cancelled = true;
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
    await ensureHotLabsWalletIframeReady();

    const client = getSafeNearClient();
    if (!client) {
      throw new Error("NEAR client not initialized");
    }

    await new Promise<void>((resolve, reject) => {
      authClient.requestSignIn.near(
        { recipient: siwnRecipient },
        {
          onSuccess: resolve,
          onError: reject,
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      authClient.signIn.near(
        { recipient: siwnRecipient },
        {
          onSuccess: resolve,
          onError: reject,
        }
      );
    });

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
  }, [getSafeNearClient, refetchSession]);

  const signOut = useCallback(async () => {
    await ensureHotLabsWalletIframeReady();

    try {
      await authClient.signOut();
    } catch (error) {
      console.error("Better Auth session sign out failed:", error);
    }

    try {
      await authClient.near.disconnect();
    } catch (error) {
      console.error("Wallet disconnect error:", error);
    } finally {
      setWalletAccountId("");
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await authClient.near.disconnect();
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  }, []);

  const viewFunction = useCallback(
    async <T = unknown>({
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
    disconnect,
    loading: isPending || !isClientReady,
    viewFunction,
    callFunction,
    nearClient,
    session,
  };
}

export { classifyNearError };
export type { NearError };
