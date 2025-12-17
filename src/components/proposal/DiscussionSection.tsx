"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Markdown } from "@/components/proposal/Markdown";
import { Textarea } from "@/components/ui/textarea";
import type {
  DiscussionSummaryResponse,
  ReplySummaryResponse,
} from "@/components/proposal/types/summaries";
import type { ProposalReply } from "@/components/proposal/types/proposals";
import type { DiscourseLinkage } from "@/types/discourse-linkage";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Glasses,
  Loader2,
  MessagesSquare,
} from "lucide-react";
import Link from "next/link";
import { ReplyCard } from "./ReplyCard";
import { toast } from "sonner";
import { sign } from "near-sign-verify";
import { useNear } from "@/hooks/useNear";
import { client } from "@/lib/orpc";
import { useGovernanceAnalytics } from "@/lib/analytics";
import { SIGNING_MESSAGES } from "@/constants/signing-messages";
import { assertSigningReady } from "@/utils/wallet/guards";
import { NearErrorAlert } from "@/components/ui/NearErrorAlert";
import {
  createNearOperationError,
  logNearError,
  type NearOperationError,
} from "@/utils/errors/near-errors";
import { siwnRecipient } from "@/config/siwn";
import { logger } from "@/lib/logger";
import { VerificationBadge } from "@/components/VerificationBadge";

interface DiscussionSectionProps {
  discourseBaseUrl: string;
  replies: ProposalReply[];
  discussionSummary: DiscussionSummaryResponse | null;
  discussionSummaryVisible: boolean;
  discussionSummaryLoading: boolean;
  discussionSummaryError: string;
  showReplies: boolean;
  onToggleReplies: () => void;
  onHandleDiscussionSummary: () => void;
  replySummaries: Record<number, ReplySummaryResponse>;
  replySummaryLoading: Record<number, boolean>;
  replySummaryErrors: Record<number, string>;
  onFetchReplySummary: (replyId: number) => void;
  onHideReplySummary: (replyId: number) => void;
  topicId: number;
  onReplyPosted?: () => void;
  topicAuthor?: string | null;
}

type ThreadedReply = ProposalReply & {
  children: ThreadedReply[];
};

type ReplyTarget = {
  postNumber: number;
  username?: string | null;
  label: string;
};

export function DiscussionSection({
  discourseBaseUrl,
  replies,
  discussionSummary,
  discussionSummaryVisible,
  discussionSummaryLoading,
  discussionSummaryError,
  showReplies,
  onToggleReplies,
  onHandleDiscussionSummary,
  replySummaries,
  replySummaryLoading,
  replySummaryErrors,
  onFetchReplySummary,
  onHideReplySummary,
  topicId,
  onReplyPosted,
  topicAuthor,
}: DiscussionSectionProps) {
  const { signedAccountId, walletSigner, signIn } = useNear();
  const track = useGovernanceAnalytics();
  const [replyContent, setReplyContent] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyError, setReplyError] = useState<NearOperationError | null>(null);
  const [checkingLinkage, setCheckingLinkage] = useState(false);
  const [linkage, setLinkage] = useState<DiscourseLinkage | null>(null);

  const topicReplyTarget = useMemo<ReplyTarget>(
    () => ({
      postNumber: 1,
      username: topicAuthor ?? null,
      label: "topic",
    }),
    [topicAuthor]
  );
  const [replyTarget, setReplyTarget] =
    useState<ReplyTarget>(topicReplyTarget);
  const replyFormRef = useRef<HTMLDivElement | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setReplyTarget((current) =>
      current.postNumber === 1 ? topicReplyTarget : current
    );
  }, [topicReplyTarget]);

  useEffect(() => {
    const checkLinkage = async () => {
      if (!signedAccountId) {
        setLinkage(null);
        return;
      }
      setCheckingLinkage(true);
      try {
        let data = (await client.discourse.getLinkage(
          signedAccountId
            ? { nearAccount: signedAccountId }
            : undefined
        )) as DiscourseLinkage | null;
        if (!data && signedAccountId) {
          data = (await client.discourse.getLinkage()) as DiscourseLinkage | null;
        }
        setLinkage(data);
      } catch (err) {
        logger.error("[discussion] failed to check linkage:", err);
        setLinkage(null);
      } finally {
        setCheckingLinkage(false);
      }
    };

    void checkLinkage();
  }, [signedAccountId]);

  const threadedReplies = useMemo(
    () => buildThreadedReplies(replies),
    [replies]
  );

  const scrollToReplyForm = useCallback(() => {
    const element = replyFormRef.current;
    if (!element || typeof element.scrollIntoView !== "function") {
      return;
    }
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    replyTextareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showReplies) {
      return;
    }
    scrollToReplyForm();
  }, [replyTarget.postNumber, scrollToReplyForm, showReplies]);

  const isLinked = Boolean(linkage?.discourseUsername);

  const handleReplyTargetSelection = (reply: ProposalReply) => {
    setReplyTarget({
      postNumber: reply.post_number,
      username: reply.username,
      label: `reply #${reply.post_number}`,
    });
  };

  const resetReplyTarget = () => {
    setReplyTarget(topicReplyTarget);
  };

  const handleReplySubmit = async () => {
    if (!replyContent.trim()) {
      setReplyError(
        createNearOperationError(new Error("Add a reply before submitting."))
      );
      return;
    }
    assertSigningReady(walletSigner, signedAccountId);
    if (!isLinked) {
      setReplyError(
        createNearOperationError(
          new Error("Link your Discourse account before replying.")
        )
      );
      return;
    }

    const targetPostNumber = replyTarget.postNumber || 1;

    setReplyLoading(true);
    setReplyError(null);
    track("discussion_reply_started", {
      props: {
        topic_id: topicId,
        reply_to_post_number: targetPostNumber,
      },
    });

    try {
      const authToken = await sign(
        SIGNING_MESSAGES.replyToProposal(topicId),
        {
          signer: walletSigner,
          recipient: siwnRecipient,
        }
      );

      const payloadForLog = {
        topicId,
        replyToPostNumber: targetPostNumber,
        username: linkage?.discourseUsername ?? undefined,
        nearAccount: signedAccountId,
      };
      logger.debug("[discussion] createPost payload", payloadForLog);
      await client.discourse.createPost({
        authToken,
        username: linkage?.discourseUsername ?? undefined,
        nearAccount: signedAccountId,
        raw: replyContent.trim(),
        topicId,
        replyToPostNumber: targetPostNumber,
      });

      toast.success("Reply posted");
      setReplyContent("");
      track("discussion_reply_succeeded", {
        props: {
          topic_id: topicId,
          reply_to_post_number: targetPostNumber,
        },
      });
      onReplyPosted?.();
      resetReplyTarget();
    } catch (err: unknown) {
      const nearError = createNearOperationError(err);
      logNearError("DiscussionSection.handleReplySubmit", nearError);
      setReplyError(nearError);
      logger.error("[discussion] reply failed:", {
        error: nearError.originalError,
        rpcData:
          err && typeof err === "object"
            ? (err as Record<string, unknown>).data
            : undefined,
        rpcName: err instanceof Error ? err.name : undefined,
        linkage,
        payload: {
          topicId,
          username: linkage?.discourseUsername,
          nearAccount: signedAccountId,
        },
      });
      track("discussion_reply_failed", {
        props: {
          topic_id: topicId,
          message: nearError.message.slice(0, 120),
          reply_to_post_number: targetPostNumber,
        },
      });
    } finally {
      setReplyLoading(false);
    }
  };

  const renderThreadedReplies = (
    nodes: ThreadedReply[],
    depth = 0
  ): ReactNode =>
    nodes.map((node) => (
      <div
        key={node.id}
        className="space-y-4"
        style={{ marginLeft: depth * 20 }}
      >
        <ReplyCard
          reply={node}
          discourseBaseUrl={discourseBaseUrl}
          summary={replySummaries[node.id]}
          loading={replySummaryLoading[node.id]}
          error={replySummaryErrors[node.id]}
          onSummarize={() => onFetchReplySummary(node.id)}
          onHideSummary={() => onHideReplySummary(node.id)}
          onReply={() => handleReplyTargetSelection(node)}
        />
        {replyTarget.postNumber === node.post_number && renderReplyForm()}
        {node.children.length > 0 && (
          <div className="space-y-4">
            {renderThreadedReplies(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));

  const renderReplyForm = () => (
    <>
      <div className="space-y-3" ref={replyFormRef}>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            Replying to{" "}
            <span className="font-semibold text-foreground">
              {replyTarget.username ? `@${replyTarget.username}` : "the topic"}
            </span>{" "}
            (#{replyTarget.postNumber})
          </p>
          {replyTarget.postNumber !== 1 && (
            <Button variant="link" size="sm" className="p-0" onClick={resetReplyTarget}>
              Reply to topic instead
            </Button>
          )}
        </div>
        <Textarea
          ref={replyTextareaRef}
          value={replyContent}
          onChange={(event) => {
            setReplyContent(event.currentTarget.value);
            if (replyError) {
              setReplyError(null);
            }
          }}
          placeholder="Write a reply to the discussion..."
          rows={4}
          className="min-h-[120px]"
        />
      </div>
      <NearErrorAlert
        error={replyError}
        onRetry={() => {
          setReplyError(null);
          void handleReplySubmit();
        }}
        onReconnect={() => {
          setReplyError(null);
          void signIn();
        }}
        onDismiss={() => setReplyError(null)}
        className="p-3"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="text-sm text-muted-foreground flex-1 space-y-1">
          <p>
            Replies are posted directly to Gov discussion on
            <span className="font-semibold"> {discourseBaseUrl}</span>.
          </p>
          <p>
            {!signedAccountId
              ? "Connect your NEAR wallet to reply."
              : checkingLinkage
              ? "Checking Discourse linkage…"
              : isLinked
              ? "You're linked and ready to reply."
              : "Link your Discourse account on the "}
            {signedAccountId &&
              !checkingLinkage &&
              !isLinked && (
                <Link
                  href="/profile"
                  className="font-semibold text-primary underline underline-offset-2"
                >
                  profile
                </Link>
              )}
            {signedAccountId && !checkingLinkage && !isLinked && " page."}
          </p>
        </div>
        <Button
          onClick={handleReplySubmit}
          disabled={
            replyLoading ||
            !signedAccountId ||
            !walletSigner ||
            !replyContent.trim() ||
            !isLinked
          }
          className="gap-1"
        >
          {replyLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Posting...
            </>
          ) : (
            "Post reply"
          )}
        </Button>
      </div>
    </>
  );

  return (
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <div
        className={`lg:sticky lg:top-16 z-20 bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)] ${
          showReplies || (discussionSummary && discussionSummaryVisible)
            ? "rounded-t-2xl"
            : "rounded-2xl"
        }`}
      >
        <CardHeader className="pb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-base font-semibold">
              <MessagesSquare className="h-5 w-5 text-muted-foreground" />
              Discussion
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                onClick={onHandleDiscussionSummary}
                disabled={discussionSummaryLoading}
                variant={
                  discussionSummary && discussionSummaryVisible
                    ? "outline"
                    : "default"
                }
                size="sm"
                className="gap-2 w-full sm:w-auto"
              >
                {discussionSummaryLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Generating...
                  </>
                ) : discussionSummary ? (
                  discussionSummaryVisible ? (
                    <>
                      <ChevronUp className="h-4 w-4" /> Hide Summary
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" /> Show Summary
                    </>
                  )
                ) : (
                  <>Summarize</>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleReplies}
                className="gap-2 w-full sm:w-auto"
              >
                {showReplies ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    <Glasses className="h-4 w-4" />
                  </>
                )}{" "}
                Replies ({replies.length})
              </Button>
            </div>
          </div>
          {discussionSummaryError && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{discussionSummaryError}</AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </div>

      <CardContent className="pt-6 space-y-6">
        {discussionSummary && discussionSummaryVisible && (
          <Alert className="bg-blue-50 border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <Badge variant="secondary">Discussion Summary</Badge>
              <VerificationBadge
                verification={
                  discussionSummary.verificationResult ??
                  discussionSummary.verification ??
                  null
                }
                className="text-[10px]"
              />
            </div>
            <AlertDescription className="space-y-4">
              <Markdown
                content={discussionSummary.summary}
                className="text-sm leading-relaxed"
              />
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {showReplies && (
            <div className="space-y-4">
              {threadedReplies.length > 0 ? (
                <div className="space-y-4">
                  {renderThreadedReplies(threadedReplies)}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No replies yet. Start the discussion with a reply below.
                </p>
              )}
              {replyTarget.postNumber === 1 && renderReplyForm()}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const buildThreadedReplies = (replies: ProposalReply[]): ThreadedReply[] => {
  if (!replies || replies.length === 0) {
    return [];
  }

  const nodes: ThreadedReply[] = replies.map((reply) => ({
    ...reply,
    children: [],
  }));
  const nodeMap = new Map<number, ThreadedReply>();
  nodes.forEach((node) => nodeMap.set(node.post_number, node));

  const roots: ThreadedReply[] = [];
  nodes.forEach((node) => {
    const parentKey =
      node.reply_to_post_number && node.reply_to_post_number > 0
        ? node.reply_to_post_number
        : 1;
    if (parentKey === 1) {
      roots.push(node);
      return;
    }
    const parent = nodeMap.get(parentKey);
    if (parent && parent.post_number !== node.post_number) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
};
