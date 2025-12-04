"use client";

import React, { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/components/providers/auth-provider";
import { toast } from "sonner";
import { siwnRecipient } from "@/config/siwn";
import { isUserRejected } from "@/lib/auth/retry";
import { nearSignInWithRetry } from "@/lib/auth/near-sign-in";

export function NearSignInCompact() {
  const {
    user,
    isPending,
    nearAccountId,
    walletAccountId,
    walletSignIn,
    walletSignOut,
  } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleAuth = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const result = await nearSignInWithRetry({
        walletAccountId,
        connectWallet: walletSignIn,
        requestSignIn: () =>
          new Promise<void>((resolve, reject) => {
            authClient.requestSignIn.near(
              { recipient: siwnRecipient },
              { onSuccess: resolve, onError: reject }
            );
          }),
        signIn: () =>
          new Promise<void>((resolve, reject) => {
            authClient.signIn.near(
              { recipient: siwnRecipient },
              { onSuccess: resolve, onError: reject }
            );
          }),
        disconnectOnError: async () => {
          await authClient.near.disconnect();
          await walletSignOut();
        },
        retryBaseDelayMs: 0,
      });

      if (result.status === "success") {
        toast.success("Signed in");
        return;
      }

      toast.error(result.message);
    } catch (err: any) {
      const rejected = isUserRejected(err);
      const message = rejected
        ? "Wallet connection cancelled"
        : err?.message || "Authentication failed";
      toast.error(message);
      if (!rejected) {
        await authClient.near.disconnect();
        await walletSignOut();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: async () => {
            await authClient.near.disconnect();
            await walletSignOut();
          },
        },
      });
      toast.success("Signed out");
    } catch (err) {
      console.error("Sign out error:", err);
      // Still try to disconnect wallets
      await authClient.near.disconnect();
      await walletSignOut();
      toast.error("Signed out locally, but session logout failed");
    } finally {
      setIsLoading(false);
    }
  };

  if (isPending) {
    return <span className="text-gray-400 text-sm">...</span>;
  }

  if (user) {
    const contact =
      typeof user === "object" && user
        ? (user as { name?: string | null; email?: string | null })
        : null;
    const displayName = nearAccountId || contact?.name || contact?.email;

    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium truncate max-w-[150px]">
          {displayName}
        </span>
        <button
          onClick={handleSignOut}
          className="text-sm text-gray-500 hover:text-gray-700 transition"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleAuth}
      disabled={isLoading}
      className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition disabled:opacity-50"
    >
      {isLoading ? "Connecting HOT Wallet..." : "Sign in with HOT Wallet"}
    </button>
  );
}
