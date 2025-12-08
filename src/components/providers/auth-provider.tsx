import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { authClient, useSession } from "@/lib/auth/auth-client";
import { useNear } from "@/hooks/useNear";
import { getNearAccountId, hasNearLinked } from "@/lib/auth/auth-utils";

type SessionData = ReturnType<typeof useSession>["data"];
type SessionUser = SessionData extends null | undefined
  ? null
  : NonNullable<SessionData>["user"] | null;
type SessionSession = SessionData extends null | undefined
  ? null
  : NonNullable<SessionData>["session"] | null;

type AuthContextType = {
  // Better Auth session state
  user: SessionUser;
  session: SessionSession;
  sessionPending: boolean;
  sessionError: Error | null;

  // Linked accounts from Better Auth
  linkedAccounts: any[];
  refreshAccounts: () => Promise<void>;
  accountsError: Error | null;

  // Unified NEAR account (from linked accounts OR connected wallet)
  nearAccountId: string | null;
  hasNear: boolean;

  // useNear wallet state (for signing, transactions)
  nearClient: ReturnType<typeof useNear>["nearClient"];
  walletAccountId: string | null;
  walletLoading: boolean;
  walletSignIn: () => Promise<void>;
  walletSignOut: () => Promise<void>;
  viewFunction: ReturnType<typeof useNear>["viewFunction"];
  callFunction: ReturnType<typeof useNear>["callFunction"];

  // Combined loading state
  isPending: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Better Auth session
  const {
    data: sessionData,
    isPending: sessionPending,
    error: sessionError,
  } = useSession();

  // useNear wallet
  const {
    signedAccountId: walletAccountIdRaw,
    loading: walletLoading,
    signIn: walletSignIn,
    signOut: walletSignOut,
    viewFunction,
    callFunction,
    nearClient,
  } = useNear();
  const walletAccountId = walletAccountIdRaw || null;

  const [linkedAccounts, setLinkedAccounts] = useState<any[]>([]);
  const [accountsError, setAccountsError] = useState<Error | null>(null);

  // Fetch linked accounts when session exists
  const refreshAccounts = useCallback(async () => {
    if (!sessionData?.session) {
      setLinkedAccounts([]);
      setAccountsError(null);
      return;
    }

    try {
      const response = await authClient.listAccounts();
      setLinkedAccounts(response.data || []);
      setAccountsError(null);
    } catch (err) {
      console.error("Failed to fetch linked accounts:", err);
      setAccountsError(
        err instanceof Error
          ? err
          : new Error("Failed to fetch linked accounts")
      );
    }
  }, [sessionData?.session]);

  useEffect(() => {
    if (sessionData?.session) {
      refreshAccounts();
    } else {
      setLinkedAccounts([]);
    }
  }, [sessionData?.session, refreshAccounts]);

  // Unified NEAR account: prefer linked account, fallback to connected wallet
  const linkedNearAccountId = getNearAccountId(linkedAccounts);
  const nearAccountId = linkedNearAccountId || walletAccountId || null;
  const hasNear = hasNearLinked(linkedAccounts) || !!walletAccountId;
  const memoWalletSignIn = useCallback(async () => {
    await walletSignIn();
  }, [walletSignIn]);
  const memoWalletSignOut = useCallback(() => walletSignOut(), [walletSignOut]);

  // Combined loading state
  const isPending = sessionPending || walletLoading;

  const contextValue = useMemo(
    () => ({
      // Session
      user: sessionData?.user ?? null,
      session: sessionData?.session ?? null,
      sessionPending,
      sessionError: sessionError ?? null,

      // Linked accounts
      linkedAccounts,
      refreshAccounts,
      accountsError,

      // Unified NEAR
      nearAccountId,
      hasNear,

      nearClient,
      walletAccountId,
      walletLoading,
      walletSignIn: memoWalletSignIn,
      walletSignOut: memoWalletSignOut,
      viewFunction,
      callFunction,

      // Combined
      isPending,
    }),
    [
      sessionData?.user,
      sessionData?.session,
      sessionPending,
      sessionError,
      linkedAccounts,
      refreshAccounts,
      nearAccountId,
      hasNear,
      nearClient,
      walletAccountId,
      walletLoading,
      memoWalletSignIn,
      memoWalletSignOut,
      viewFunction,
      callFunction,
      isPending,
      accountsError,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useRequireAuth() {
  const auth = useAuth();
  if (!auth.isPending && !auth.user) {
    throw new Error("Authentication required");
  }
  return auth;
}
