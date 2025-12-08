"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { toast } from "sonner";
import { isUserRejected } from "@/lib/auth/retry";

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

  const handleSignIn = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      await walletSignIn();
      toast.success("Signed in");
    } catch (err: any) {
      const rejected = isUserRejected(err);
      const message = rejected
        ? "Sign in cancelled"
        : err?.message || "Failed to sign in";
      if (!rejected) {
        toast.error(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      await walletSignOut();
      toast.success("Signed out");
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isPending) {
    return <span className="text-gray-400 text-sm">...</span>;
  }

  if (user) {
    const displayName = nearAccountId || walletAccountId;

    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium truncate max-w-[150px]">
          {displayName}
        </span>
        <button
          onClick={handleSignOut}
          disabled={isLoading}
          className="text-sm text-gray-500 hover:text-gray-700 transition disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleSignIn}
      disabled={isLoading}
      className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition disabled:opacity-50"
    >
      {isLoading ? "Signing in..." : "Sign in"}
    </button>
  );
}
