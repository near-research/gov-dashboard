import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/components/providers/auth-provider";
import { authClient } from "@/lib/auth-client";
import { useGovernanceAnalytics } from "@/lib/analytics";
import { client } from "@/lib/orpc";
import { shouldRetryNonce } from "@/lib/auth/retry";
import { Loader2, LogOut, User, Plus } from "lucide-react";
import NearLogo from "/public/near-logo.svg";
import { siwnRecipient } from "@/config/siwn";

const formatAuthError = (err: any) => {
  const code = err?.code ?? err?.data?.code;
  if (code === "NETWORK_MISMATCH") {
    return "Connected wallet is on a different network.";
  }
  if (code === "NONCE_NOT_FOUND") {
    return "Session expired. Retrying…";
  }
  return err?.message || "Authentication failed";
};

export const Navigation = () => {
  const router = useRouter();
  const {
    user,
    nearAccountId,
    walletAccountId,
    isPending,
    walletSignIn,
    walletSignOut,
  } = useAuth();
  const track = useGovernanceAnalytics();
  const [isDiscourseLinked, setIsDiscourseLinked] = useState(false);
  const [checkingDiscourse, setCheckingDiscourse] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Use the authenticated NEAR account, falling back to connected wallet
  const displayAccountId = nearAccountId || walletAccountId;

  // Check Discourse linkage status
  useEffect(() => {
    const checkDiscourseLink = async () => {
      if (!displayAccountId) {
        setIsDiscourseLinked(false);
        return;
      }

      if (
        typeof displayAccountId !== "string" ||
        displayAccountId.length === 0
      ) {
        setIsDiscourseLinked(false);
        return;
      }

      setCheckingDiscourse(true);

      try {
        const data = await client.discourse.getLinkage({
          nearAccount: displayAccountId,
        });
        setIsDiscourseLinked(!!data);
      } catch (error: any) {
        setIsDiscourseLinked(false);
      } finally {
        setCheckingDiscourse(false);
      }
    };

    checkDiscourseLink();
  }, [displayAccountId]);

  const handleSignIn = async () => {
    track("wallet_connect_clicked");
    setIsSigningIn(true);
    let retriedNonce = false;

    try {
      // Step 1: Connect wallet if not connected
      if (!walletAccountId) {
        await walletSignIn();
      }

      const attemptSignIn = async () => {
        await authClient.requestSignIn.near(
          { recipient: siwnRecipient },
          {
            onSuccess: async () => {
              await authClient.signIn.near(
                { recipient: siwnRecipient },
                {
                  onSuccess: () => {
                    setIsSigningIn(false);
                    track("wallet_connect_succeeded", {
                      props: { account_id: walletAccountId || "unknown" },
                    });
                    toast.success("Signed in successfully");
                  },
                  onError: async (err: any) => {
                    if (shouldRetryNonce(err) && !retriedNonce) {
                      retriedNonce = true;
                      await attemptSignIn();
                      return;
                    }
                    setIsSigningIn(false);
                    const message = formatAuthError(err);
                    track("wallet_connect_failed", {
                      props: { message, code: err?.code },
                    });
                    toast.error(message);
                  },
                }
              );
            },
            onError: async (err: any) => {
              if (shouldRetryNonce(err) && !retriedNonce) {
                retriedNonce = true;
                await attemptSignIn();
                return;
              }
              setIsSigningIn(false);
              const message = formatAuthError(err);
              track("wallet_connect_failed", {
                props: { message, code: err?.code },
              });
              toast.error(message);
            },
          }
        );
      };

      await attemptSignIn();
    } catch (error) {
      setIsSigningIn(false);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to connect wallet. Please try again.";

      // Don't show error for user rejection
      if (!message.toLowerCase().includes("user rejected")) {
        track("wallet_connect_failed", { props: { message } });
        toast.error(message);
      }
    }
  };

  const handleSignOut = async () => {
    track("wallet_disconnect_clicked");
    try {
      // Sign out from Better Auth session
      await authClient.signOut();
      // Disconnect Better Auth's embedded wallet
      await authClient.near.disconnect();
      // Disconnect useNear wallet
      await walletSignOut();
      toast.success("Signed out");
    } catch (error) {
      console.error("Failed to sign out:", error);
      // Still try to disconnect wallets even if session sign-out fails
      try {
        await authClient.near.disconnect();
        await walletSignOut();
      } catch (e) {
        console.error("Failed to disconnect wallets:", e);
      }
    }
  };

  const getInitials = (accountId: string) => {
    return accountId.slice(0, 2).toUpperCase();
  };

  const isOnNewProposalPage = router.pathname === "/proposals/new";
  const isLoading = isPending || isSigningIn;

  return (
    <nav className="sticky top-0 z-50 bg-background border-b">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <Image
              priority
              src={NearLogo}
              alt="NEAR"
              width={30}
              height={30}
              className="cursor-pointer"
            />
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Draft Button */}
            {!isOnNewProposalPage && (
              <Button
                size="sm"
                onClick={() => router.push("/proposals/new")}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Draft
              </Button>
            )}

            {/* Wallet / Auth */}
            {isLoading ? (
              <Button size="sm" variant="outline" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
              </Button>
            ) : user && displayAccountId ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 relative"
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {getInitials(displayAccountId)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:inline-block max-w-[150px] truncate">
                      {displayAccountId}
                    </span>
                    {/* Discourse Connected Indicator */}
                    {!checkingDiscourse && isDiscourseLinked && (
                      <span
                        className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-background"
                        title="Discourse Connected"
                        aria-label="Discourse Connected"
                      />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <span>My Account</span>
                    {/* Discourse Status */}
                    {checkingDiscourse ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    ) : (
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isDiscourseLinked ? "bg-emerald-500" : "bg-gray-300"
                        }`}
                        title={
                          isDiscourseLinked
                            ? "Discourse Connected"
                            : "Discourse Not Linked"
                        }
                      />
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    router.push("/profile");
                  }}
                >
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : walletAccountId && !user ? (
              <Button
                size="sm"
                onClick={handleSignIn}
                disabled={isLoading}
                className="gap-2"
                aria-label={`Sign in with ${walletAccountId}`}
              >
                <span className="hidden sm:inline-block max-w-[100px] truncate">
                  {walletAccountId}
                </span>
                <span className="sm:hidden">Sign In</span>
                <span className="hidden sm:inline">→ Sign In</span>
              </Button>
            ) : (
              <Button size="sm" onClick={handleSignIn} disabled={isLoading}>
                Connect Wallet
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
