"use client";

import { useCallback, useEffect, useState } from "react";
import { useNear } from "@/hooks/useNear";
import { client } from "@/lib/orpc";
import { WalletStatus } from "@/components/profile/WalletStatus";
import { DiscourseConnect } from "@/components/profile/DiscourseConnect";
import { servicesConfig } from "@/config/services";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Wallet,
  MessagesSquare,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  MessageCircle,
} from "lucide-react";

type AccountView = {
  amount: string;
};

type DiscourseUserResponse = {
  user_badges: Array<{
    id: number;
    badge_id: number;
    badge?: { name?: string } | null;
  }>;
  user?: {
    avatar_template?: string;
    trust_level?: number;
    badge_count?: number;
    post_count?: number;
    time_read?: number;
    last_seen_at?: string | null;
    created_at?: string | null;
  };
};

const YOCTO_NEAR = BigInt("1000000000000000000000000");

const formatNearBalance = (amount: string) => {
  try {
    const yocto = BigInt(amount);
    const whole = yocto / YOCTO_NEAR;
    const fraction = yocto % YOCTO_NEAR;
    let fractionStr = fraction.toString().padStart(24, "0").slice(0, 2);
    fractionStr = fractionStr.replace(/0+$/, "");
    return fractionStr
      ? `${whole.toString()}.${fractionStr}`
      : whole.toString();
  } catch {
    return "--";
  }
};

const formatDate = (iso?: string | null) => {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "--";
  }
};

export default function Profile() {
  const {
    signedAccountId,
    wallet,
    loading: walletLoading,
    provider,
  } = useNear();
  const [discourseLink, setDiscourseLink] = useState<any>(null);
  const [discourseCheckFailed, setDiscourseCheckFailed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [nearBalance, setNearBalance] = useState<string | null>(null);
  const [veNearBalance, setVeNearBalance] = useState<string | null>(null);
  const [badges, setBadges] = useState<string[]>([]);
  const [badgesLoading, setBadgesLoading] = useState(false);
  const [badgesError, setBadgesError] = useState("");
  const [discourseProfile, setDiscourseProfile] = useState<{
    avatarUrl: string | null;
    trustLevel: number | null;
    badgeCount: number | null;
    postCount: number | null;
    timeReadHours: number | null;
    lastSeenAt: string | null;
    createdAt: string | null;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadProfile = useCallback(async () => {
    if (!signedAccountId) return;

    try {
      const linkData = await client.discourse.getLinkage({
        nearAccount: signedAccountId,
      });
      setDiscourseLink(linkData);
      setDiscourseCheckFailed(false);
    } catch (error) {
      console.log("Discourse plugin server not available");
      setDiscourseCheckFailed(true);
    }
  }, [signedAccountId]);

  useEffect(() => {
    if (!signedAccountId || !provider) {
      setNearBalance(null);
      return;
    }

    let cancelled = false;
    const fetchBalance = async () => {
      try {
        const accountView = (await provider.query({
          request_type: "view_account",
          account_id: signedAccountId,
          finality: "final",
        })) as unknown as AccountView;
        if (!cancelled) {
          setNearBalance(formatNearBalance(accountView.amount));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch NEAR balance:", error);
          setNearBalance(null);
        }
      }
    };

    fetchBalance();
    setVeNearBalance(null); // Placeholder until veNEAR data source is available

    return () => {
      cancelled = true;
    };
  }, [provider, signedAccountId]);

  useEffect(() => {
    if (!discourseLink?.discourseUsername) {
      setBadges([]);
      setBadgesError("");
      setDiscourseProfile(null);
      return;
    }

    const controller = new AbortController();
    const fetchBadges = async () => {
      setBadgesLoading(true);
      setBadgesError("");
      try {
        const response = await fetch(
          `/api/discourse/user/${encodeURIComponent(
            discourseLink.discourseUsername
          )}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch badges (${response.status})`);
        }
        const data = (await response.json()) as DiscourseUserResponse;
        const badgeNames = data.user_badges
          .map((entry) => entry.badge?.name)
          .filter((name): name is string => Boolean(name));
        setBadges(badgeNames);
        const user = data.user ?? {};
        const avatarUrl = user.avatar_template
          ? `${servicesConfig.discourseBaseUrl}${user.avatar_template.replace(
              "{size}",
              "120"
            )}`
          : null;
        setDiscourseProfile({
          avatarUrl,
          trustLevel: user.trust_level ?? null,
          badgeCount: user.badge_count ?? null,
          postCount: user.post_count ?? null,
          timeReadHours:
            typeof user.time_read === "number"
              ? Math.round(user.time_read / 60)
              : null,
          lastSeenAt: user.last_seen_at ?? null,
          createdAt: user.created_at ?? null,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to load badges:", error);
          setBadgesError("Unable to load badges right now.");
          setDiscourseProfile(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setBadgesLoading(false);
        }
      }
    };

    fetchBadges();
    return () => controller.abort();
  }, [discourseLink?.discourseUsername]);

  useEffect(() => {
    if (signedAccountId) {
      loadProfile();
    }
  }, [signedAccountId, loadProfile]);

  const getInitials = (accountId: string) => {
    return accountId.slice(0, 2).toUpperCase();
  };

  if (!mounted || walletLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-10 px-4 py-10">
        <Card>
          <CardContent className="flex items-center gap-6 py-6">
            <div className="h-20 w-20 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-6 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!signedAccountId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Connect your wallet to view your profile
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WalletStatus
              signedAccountId={signedAccountId}
              loading={walletLoading}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-12">
      {/* Profile Header */}
      <Card className="rounded-3xl border border-slate-200 shadow-lg shadow-slate-100/60">
        <CardContent className="py-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20 border-2 border-white shadow-sm">
                  {discourseProfile?.avatarUrl && (
                    <AvatarImage src={discourseProfile.avatarUrl} alt="" />
                  )}
                  <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                    {getInitials(signedAccountId)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-3xl font-bold font-mono tracking-tight text-slate-900">
                    {signedAccountId}
                  </h1>
                </div>
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row sm:gap-4 lg:w-auto">
                <div className="min-w-[160px] rounded-2xl border border-slate-200 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    NEAR Balance
                  </p>
                  <p className="text-2xl font-semibold text-slate-900">
                    {nearBalance ?? "--"}
                    <span className="ml-1 text-sm font-normal text-slate-500">
                      NEAR
                    </span>
                  </p>
                </div>
                <div className="min-w-[160px] rounded-2xl border border-slate-200 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    veNEAR Balance
                  </p>
                  <p className="text-2xl font-semibold text-slate-900">
                    {veNearBalance ?? "--"}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex flex-wrap items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                <span className="font-semibold text-slate-900">
                  NEAR Wallet
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected
                </span>
              </div>

              {discourseLink?.discourseUsername && (
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-slate-900">
                    Discourse:
                  </span>
                  @{discourseLink.discourseUsername}
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    Connected
                  </span>
                </div>
              )}
              {!discourseLink && !discourseCheckFailed && (
                <div className="flex items-center gap-2 text-slate-500">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  <span>Discourse not linked yet</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Discourse Integration */}
      <Card className="rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageCircle className="h-5 w-5 text-primary" />
            Discourse Integration
          </CardTitle>
          <CardDescription className="text-base text-slate-600">
            Link your NEAR account to participate in governance discussions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {discourseCheckFailed ? (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800">
                Plugin Unavailable
              </AlertTitle>
              <AlertDescription className="text-amber-700">
                <p>
                  Discourse plugin server is not running. Start it to check
                  linkage status and publish proposals.
                </p>
                <code className="mt-2 block rounded bg-amber-100 px-2 py-1 text-sm">
                  cd discourse-plugin && bun run dev
                </code>
              </AlertDescription>
            </Alert>
          ) : discourseLink?.discourseUsername ? (
            <>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-lg font-semibold">Linked to Discourse</p>
                  <p className="text-sm text-emerald-900/80">
                    @{discourseLink.discourseUsername}
                  </p>
                </div>
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
              >
                <a
                  href={`https://gov.near.org/u/${discourseLink.discourseUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  View Profile
                </a>
              </Button>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-sm font-semibold text-slate-900">
                  Discourse Badges
                </p>
                {badgesLoading ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="h-6 w-16 animate-pulse rounded-full bg-slate-200" />
                    <span className="h-6 w-20 animate-pulse rounded-full bg-slate-200" />
                    <span className="h-6 w-14 animate-pulse rounded-full bg-slate-200" />
                  </div>
                ) : badgesError ? (
                  <p className="mt-2 text-sm text-slate-500">{badgesError}</p>
                ) : badges.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {badges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No badges earned yet.
                  </p>
                )}
              </div>

              {discourseProfile && (
                <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Trust Level
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {discourseProfile.trustLevel ?? "--"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Badges Earned
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {discourseProfile.badgeCount ?? badges.length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Posts
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {discourseProfile.postCount ?? "--"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Time Read
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {discourseProfile.timeReadHours ?? "--"}
                      {discourseProfile.timeReadHours !== null && " hrs"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Last Seen
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {formatDate(discourseProfile.lastSeenAt)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Member Since
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {formatDate(discourseProfile.createdAt)}
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <DiscourseConnect
              signedAccountId={signedAccountId}
              wallet={wallet}
              onLinked={(result) => {
                setDiscourseLink(result);
              }}
              onError={(error) => {
                console.error("Discourse linking error:", error);
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
