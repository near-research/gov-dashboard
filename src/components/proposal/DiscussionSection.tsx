"use client";

import { useEffect, useState } from "react";
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
import { getDiscourseUserApiKey } from "@/utils/discourse";
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
}

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
}: DiscussionSectionProps) {
  const { signedAccountId, walletSigner, signIn } = useNear();
  const track = useGovernanceAnalytics();
  const [replyContent, setReplyContent] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyError, setReplyError] = useState<NearOperationError | null>(null);
  const [checkingLinkage, setCheckingLinkage] = useState(false);
  const [linkage, setLinkage] = useState<DiscourseLinkage | null>(null);

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

  if (!replies || replies.length === 0) {
    return null;
  }

  const isLinked = Boolean(linkage?.discourseUsername);

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

    setReplyLoading(true);
    setReplyError(null);
    track("discussion_reply_started", {
      props: { topic_id: topicId },
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
        replyToPostNumber: 1,
        username: linkage?.discourseUsername ?? undefined,
        nearAccount: signedAccountId,
      };
      logger.debug("[discussion] createPost payload", payloadForLog);
      const userApiKey =
        linkage?.userApiKey ?? getDiscourseUserApiKey() ?? undefined;

      await client.discourse.createPost({
        authToken,
        username: linkage?.discourseUsername ?? undefined,
        userApiKey,
        nearAccount: signedAccountId,
        raw: replyContent.trim(),
        topicId,
        replyToPostNumber: 1,
      });

      toast.success("Reply posted");
      setReplyContent("");
      track("discussion_reply_succeeded", {
        props: { topic_id: topicId },
      });
      onReplyPosted?.();
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
        },
      });
    } finally {
      setReplyLoading(false);
    }
  };

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
          <div className="space-y-3">
            <Textarea
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
          </div>

          {showReplies && (
            <div className="space-y-4">
              {replies.map((reply) => (
                <ReplyCard
                  key={reply.id}
                  reply={reply}
                  discourseBaseUrl={discourseBaseUrl}
                  summary={replySummaries[reply.id]}
                  loading={replySummaryLoading[reply.id]}
                  error={replySummaryErrors[reply.id]}
                  onSummarize={() => onFetchReplySummary(reply.id)}
                  onHideSummary={() => onHideReplySummary(reply.id)}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
