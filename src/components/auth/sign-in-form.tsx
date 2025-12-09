"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { toast } from "sonner";
import { isUserRejected, shouldRetryNonce } from "@/lib/auth/retry";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isPending, walletAccountId, walletSignIn, walletSignOut } =
    useAuth();
  const redirect = searchParams.get("redirect") || "/";

  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    if (user && !isPending && !hasRedirected) {
      setHasRedirected(true);
      router.push(redirect);
    }
  }, [user, isPending, hasRedirected, router, redirect]);

  const handleSignIn = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    setError(null);

    let retriedNonce = false;

    const executeSignIn = async () => {
      await walletSignIn();
      toast.success("Signed in successfully");
    };

    try {
      await executeSignIn();
    } catch (err: any) {
      let errorToReport = err;

      if (shouldRetryNonce(err) && !retriedNonce) {
        retriedNonce = true;
        try {
          await executeSignIn();
          setIsConnecting(false);
          return;
        } catch (retryErr: any) {
          errorToReport = retryErr;
        }
      }

      const rejected = isUserRejected(errorToReport);
      const message = rejected
        ? "Sign in cancelled"
        : errorToReport?.message || "Failed to sign in";
      setError(message);
      if (!rejected) {
        toast.error(message);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await walletSignOut();
      toast.success("Disconnected");
    } catch (err) {
      console.error("Disconnect error:", err);
    }
  };

  if (isPending) {
    return (
      <div className="w-full max-w-md mx-auto p-8">
        <div className="text-center text-gray-500">Loading...</div>
      </div>
    );
  }

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
          {!user ? (
            <button
              data-testid="sign-in-connect-button"
              onClick={handleSignIn}
              disabled={isConnecting}
              className="w-full py-3 px-4 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50"
            >
              {isConnecting ? "Connecting & Signing..." : "Connect Wallet"}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg text-center">
                <p className="text-sm text-gray-500">Signed in as</p>
                <p className="font-mono font-medium">
                  {walletAccountId || "Connected wallet"}
                </p>
              </div>
              <button
                onClick={handleDisconnect}
                className="w-full py-3 px-4 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition"
              >
                Sign Out
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
