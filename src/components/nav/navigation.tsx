import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
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
import { useNear } from "@/hooks/useNear";
import { Loader2, LogOut, User, Plus } from "lucide-react";
import NearLogo from "/public/near-logo.svg";

export const Navigation = () => {
  const router = useRouter();
  const { wallet, signedAccountId, loading, signIn, signOut } = useNear();

  const handleSignIn = async () => {
    console.log("Connect Wallet clicked", { wallet, signedAccountId, loading });

    try {
      console.log("Attempting to sign in...");
      await signIn();
      console.log("Sign in successful");
    } catch (error) {
      console.error("Failed to sign in:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to connect wallet. Please try again.";
      toast.error(message);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Failed to sign out:", error);
    }
  };

  const getInitials = (accountId: string) => {
    return accountId.slice(0, 2).toUpperCase();
  };

  // Check if we're on the new proposal page
  const isOnNewProposalPage = router.pathname === "/proposals/new";

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
            {/* Draft Proposal Button - Hidden when on new proposal page */}
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
            {loading ? (
              <Button size="sm" variant="outline" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
              </Button>
            ) : signedAccountId ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 relative"
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {getInitials(signedAccountId)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:inline-block max-w-[150px] truncate">
                      {signedAccountId}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>
                    <User className="mr-2 h-4 w-4" />
                    <span className="truncate">{signedAccountId}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button size="sm" onClick={handleSignIn} disabled={loading}>
                Connect Wallet
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
