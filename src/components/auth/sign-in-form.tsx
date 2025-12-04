"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/components/providers/auth-provider";
import { toast } from "sonner";
import { siwnRecipient } from "@/config/siwn";
import { isUserRejected } from "@/lib/auth/retry";
import { nearSignInWithRetry } from "@/lib/auth/near-sign-in";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    user,
    isPending,
    walletAccountId,
    walletSignIn,
    walletSignOut,
  } = useAuth();
  const redirect = searchParams.get("redirect") || "/";

  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    if (user && !isPending && !hasRedirected) {
      setHasRedirected(true);
      router.push(redirect);
    }
  }, [user, isPending, hasRedirected, router, redirect]);

  // Step 1: Connect wallet using useNear (hot-labs/near-connect)
  const handleConnectWallet = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      await walletSignIn();
      toast.success("Wallet connected");
    } catch (err: any) {
      const rejected = isUserRejected(err);
      const message = rejected ? "Wallet connection cancelled" : err?.message || "Failed to connect wallet";
      setError(message);
      toast.error(message);
    } finally {
      setIsConnecting(false);
    }
  };

  // Step 2: Authenticate with Better Auth (creates session)
  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setError(null);

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
        toast.success(
          `Signed in as ${walletAccountId || "your connected wallet"}`
        );
        router.push(redirect);
        return;
      }

      setError(result.message);
      toast.error(result.message);
    } catch (err: any) {
      const rejected = isUserRejected(err);
      const message = rejected ? "Wallet connection cancelled" : err?.message || "Authentication failed";
      setError(message);
      toast.error(message);
    } finally {
      setIsSigningIn(false);
    }
  };

  // Disconnect both wallets and sign out
  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      try {
        await authClient.signOut();
      } catch (err: any) {
        toast.error(err?.message || "Failed to sign out from session");
      }

      await authClient.near.disconnect();
      await walletSignOut();
      toast.success("Disconnected");
    } catch (err) {
      console.error("Disconnect error:", err);
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isPending) {
    return (
      <div className="w-full max-w-md mx-auto p-8">
        <div className="text-center text-gray-500">Loading...</div>
      </div>
    );
  }

  // Already signed in
  if (user && hasRedirected) {
    return null;
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white border rounded-lg shadow-sm p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-2">Sign in to Continue</h1>
          <p className="text-gray-500">Connect your NEAR wallet</p>
        </div>

        <div className="space-y-4">
          {!walletAccountId ? (
            <button
              onClick={handleConnectWallet}
              disabled={isConnecting}
              className="w-full py-3 px-4 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50"
            >
              {isConnecting ? "Connecting HOT Wallet..." : "Connect HOT Wallet"}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg text-center">
                <p className="text-sm text-gray-500">Connected wallet</p>
                <p className="font-mono font-medium">{walletAccountId}</p>
              </div>

              <button
                onClick={handleSignIn}
                disabled={isSigningIn}
                className="w-full py-3 px-4 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50"
              >
                {isSigningIn
                  ? "Sign message in HOT Wallet..."
                  : "Sign In with HOT Wallet"}
              </button>

              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="w-full py-3 px-4 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect Wallet"}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-4 text-red-500 text-sm text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
