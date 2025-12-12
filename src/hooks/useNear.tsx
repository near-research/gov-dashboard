"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authClient, safeSignOut, useSession } from "@/lib/auth/auth-client";
import { siwnRecipient } from "@/config/siwn";
import { shouldRetryNonce } from "@/lib/auth/retry";
import { NearError, type Near, type SignMessageParams } from "near-kit";
import type { WalletInterface } from "near-sign-verify";

type PlaywrightMockWallet = {
  accountId: string;
  signMessage: (params: SignMessageParams) => Promise<{
    signature: string;
    publicKey: string;
    accountId: string;
  }>;
};

type WindowWithMockWallet = Window & {
  __PLAYWRIGHT_MOCK_WALLET__?: PlaywrightMockWallet;
};

const getPlaywrightMockWallet = (): PlaywrightMockWallet | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const win = window as WindowWithMockWallet;
  return win.__PLAYWRIGHT_MOCK_WALLET__ ?? null;
};

const mockBalance = {
  amount: "0",
  locked: "0",
  code_hash: "11111111111111111111111111111111",
  storage_usage: 0,
  storage_paid_at: 0,
  block_height: 1,
  block_hash: "00000000000000000000000000000000",
};

const createMockNearClient = (wallet: PlaywrightMockWallet): Near =>
  ({
    view: async () => {
      return {};
    },
    call: async () => {
      return {};
    },
    signMessage: (params: SignMessageParams) => wallet.signMessage(params),
    getBalance: async () => mockBalance,
  } as unknown as Near);

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
  const [isSignInPending, setIsSignInPending] = useState(false);
  const signInPromiseRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const initializeClient = async () => {
      try {
        const mockWallet = getPlaywrightMockWallet();
        if (mockWallet) {
          const client = createMockNearClient(mockWallet);
          if (cancelled) {
            return;
          }
          setNearClient(client);
          setWalletAccountId(mockWallet.accountId);
          setIsClientReady(true);
          return;
        }

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

    const mockWallet = getPlaywrightMockWallet();
    if (mockWallet) {
      return createMockNearClient(mockWallet);
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

  const walletSigner = useMemo<WalletInterface | null>(() => {
    if (!signedAccountId) {
      return null;
    }

    return {
      signMessage(params: SignMessageParams) {
        const client = authClient.near.getNearClient();
        return client.signMessage(params, { signerId: signedAccountId });
      },
    };
  }, [signedAccountId]);

  const signIn = useCallback(async () => {
    if (!getSafeNearClient()) {
      throw new Error("NEAR client not initialized");
    }

    if (signInPromiseRef.current) {
      return signInPromiseRef.current;
    }

    const runSignIn = async () => {
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
    };

    const promise = runSignIn();
    signInPromiseRef.current = promise;
    setIsSignInPending(true);

    promise.finally(() => {
      signInPromiseRef.current = null;
      setIsSignInPending(false);
    });

    return promise;
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
      if (signInPromiseRef.current) {
        signInPromiseRef.current = null;
      }
      setIsSignInPending(false);
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
    walletSigner,
    session,
    isSignInPending,
  };
}

export { classifyNearError };
export type { NearError };
