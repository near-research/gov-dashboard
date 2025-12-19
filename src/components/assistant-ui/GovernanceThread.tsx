"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ThreadPrimitive,
  ComposerPrimitive,
  AssistantIf,
} from "@assistant-ui/react";
import { GovernanceMessage } from "./GovernanceMessage";
import { GovernanceToolUIs } from "./tools";
import { useGovernanceAnalytics } from "@/lib/analytics";
import { useVerificationSafe } from "@/contexts/VerificationContext";
import {
  Send,
  Square,
  ChevronDown,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import ProposalCard from "@/components/proposal/ProposalCard";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/tailwind";
import type { LatestPostsResponse } from "@/types/discourse";

type Post = LatestPostsResponse["latest_posts"][number] & {
  near_wallet?: string;
};

const PROPOSALS_PER_PAGE = 20;
const PROPOSALS_PAGE = 0;

const QUICK_ACTION_PROMPTS = [
  "What proposals are currently active?",
  "Summarize the latest governance discussions",
  "How does the voting process work?",
  "What is veNEAR and how does delegation work?",
];

const sanitizeExcerpt = (html?: string) => {
  if (!html) return "";
  const withoutTags = html.replace(/<[^>]*>/g, " ");
  const withoutEmojis = withoutTags.replace(/:[a-z_]+:/g, "");
  return withoutEmojis.replace(/\s+/g, " ").trim();
};

function useLatestProposals() {
  const track = useGovernanceAnalytics();
  const trackRef = useRef(track);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  const refreshProposals = useCallback(async () => {
    setLoading(true);
    setError("");

    trackRef.current("home_latest_proposals_requested");

    try {
      const params = new URLSearchParams({
        per_page: String(PROPOSALS_PER_PAGE),
        page: String(PROPOSALS_PAGE),
      });

      const response = await fetch(
        `/api/discourse/latest?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch proposals");
      }

      const data: LatestPostsResponse = await response.json();
      const latestPosts = (data.latest_posts || [])
        .slice(0, PROPOSALS_PER_PAGE)
        .map((post) => ({
          ...post,
          excerpt: sanitizeExcerpt(post.excerpt),
        }));
      setPosts(latestPosts);

      trackRef.current("home_latest_proposals_succeeded", {
        props: {
          count: latestPosts.length,
        },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch proposals";
      setError(message);

      trackRef.current("home_latest_proposals_failed", {
        props: {
          message: message.slice(0, 120),
        },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProposals();
  }, [refreshProposals]);

  return { posts, loading, error, refresh: refreshProposals };
}

function LatestProposalsSection() {
  const { posts, loading, error, refresh } = useLatestProposals();

  return (
    <div className="w-full max-w-4xl space-y-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Recent proposals
            </h3>
            <p className="text-sm text-muted-foreground">
              Automatically surfaced from the NEAR governance forum
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <Card key={item}>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <div className="flex gap-4 pt-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : posts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">No proposals found</h3>
              <p className="text-sm text-muted-foreground">
                Check back later for new proposals
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <ProposalCard
              key={post.id}
              id={post.id}
              title={post.title}
              excerpt={post.excerpt}
              created_at={post.created_at}
              username={post.username}
              topic_id={post.topic_id}
              topic_slug={post.topic_slug}
              reply_count={post.reply_count}
              views={post.views}
              last_posted_at={post.last_posted_at}
              near_wallet={post.near_wallet}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadEmpty() {
  const verification = useVerificationSafe();
  const isVerified = verification?.state.status === "verified";

  return (
    <div className="flex flex-col items-center gap-4 pb-2 text-left">
      <div className="text-center flex flex-col items-center gap-3">
        {isVerified && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-accent" />
          </div>
        )}
      </div>
    </div>
  );
}

function ScrollToBottomButton() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button
        className={cn(
          "absolute bottom-28 right-6 z-10",
          "p-2.5 rounded-full",
          "bg-background",
          "border border-border",
          "shadow-lg",
          "hover:bg-muted/70",
          "transition-all",
          "disabled:opacity-0 disabled:pointer-events-none"
        )}
        title="Scroll to bottom"
      >
        <ChevronDown className="w-5 h-5 text-muted-foreground" />
      </button>
    </ThreadPrimitive.ScrollToBottom>
  );
}

function QuickActionRow() {
  return (
    <div className="px-4 sm:px-8">
      <div className="flex flex-wrap gap-2 justify-center max-w-4xl mx-auto py-2">
        {QUICK_ACTION_PROMPTS.map((prompt) => (
          <ThreadPrimitive.Suggestion
            key={`quick-${prompt}`}
            prompt={prompt}
            className="px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 rounded-full transition-colors cursor-pointer"
          >
            {prompt}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}

interface ThreadComposerProps {
  showQuickActions?: boolean;
}

function ThreadComposer({ showQuickActions = true }: ThreadComposerProps) {
  return (
    <div className="sticky bottom-0 inset-x-0 w-full border-t border-border bg-background px-4 pb-3 pt-1 shadow-[0_-4px_20px_rgba(15,23,42,0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/90 z-10">
      {showQuickActions && <QuickActionRow />}
      <ComposerPrimitive.Root className="flex items-center gap-3 w-full">
        <ComposerPrimitive.Input asChild>
          <Textarea
            placeholder="Ask about governance, proposals, voting..."
            className="flex-1 h-[40px] rounded-2xl border border-border bg-muted/60 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 resize-none"
            rows={1}
            autoFocus
            data-testid="chat-input"
          />
        </ComposerPrimitive.Input>

        <AssistantIf condition={({ thread }) => !thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <Button
              variant="default"
              size="icon"
              className="shadow-lg"
              title="Send message"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </Button>
          </ComposerPrimitive.Send>
        </AssistantIf>

        <AssistantIf condition={({ thread }) => thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              variant="destructive"
              size="icon"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square className="w-4 h-4" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AssistantIf>
      </ComposerPrimitive.Root>
    </div>
  );
}

export interface GovernanceThreadProps {
  showProposals?: boolean;
}

export function GovernanceThread({
  showProposals = true,
}: GovernanceThreadProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (showProposals && viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }
  }, [showProposals]);
  return (
    <>
      <GovernanceToolUIs />

      <div className="flex flex-col h-full bg-background text-foreground">
        <ThreadPrimitive.Root className="relative flex flex-col flex-1 min-h-0 mx-auto w-full max-w-4xl">
          <ThreadPrimitive.Viewport
            ref={viewportRef}
            className="flex-1 overflow-y-auto px-4 sm:px-8 pb-32 pt-24 min-h-0"
          >
            <ThreadPrimitive.Empty>
              <ThreadEmpty />
            </ThreadPrimitive.Empty>

            {showProposals && (
              <div className="flex justify-center -mt-2">
                <LatestProposalsSection />
              </div>
            )}

            <AssistantIf condition={({ thread }) => !thread.isEmpty}>
              <div className="min-h-8 flex-grow" />
            </AssistantIf>

            <div className="max-w-4xl mx-auto w-full">
              <ThreadPrimitive.Messages
                components={{ Message: GovernanceMessage }}
              />
            </div>

            <div className="h-4" />
          </ThreadPrimitive.Viewport>

          <ScrollToBottomButton />
          <ThreadComposer showQuickActions={showProposals} />
        </ThreadPrimitive.Root>
      </div>
    </>
  );
}
