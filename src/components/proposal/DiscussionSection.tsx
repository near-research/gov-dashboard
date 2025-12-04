import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Markdown } from "@/components/proposal/Markdown";
import { VerificationProof } from "@/components/verification/VerificationProof";
import { extractExpectationsFromProposal } from "@/utils/attestation/expectations";
import type {
  DiscussionSummaryResponse,
  ReplySummaryResponse,
} from "@/types/summaries";
import type { ProposalReply } from "@/types/proposals";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Glasses,
  Loader2,
  MessagesSquare,
} from "lucide-react";
import { ReplyCard } from "./ReplyCard";

interface DiscussionSectionProps {
  discourseUrl: string;
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
}

export function DiscussionSection({
  discourseUrl,
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
}: DiscussionSectionProps) {
  if (!replies || replies.length === 0) {
    return null;
  }

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

      {(showReplies || (discussionSummary && discussionSummaryVisible)) && (
        <CardContent className="pt-6 space-y-4">
          {discussionSummary && discussionSummaryVisible && (
            <Alert className="bg-blue-50 border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">Discussion Summary</Badge>
              </div>
              <AlertDescription className="space-y-4">
                <Markdown
                  content={discussionSummary.summary}
                  className="text-sm leading-relaxed"
                />
                {(() => {
                  const expectations =
                    extractExpectationsFromProposal(discussionSummary);
                  return (
                    <VerificationProof
                      verification={discussionSummary.verification ?? undefined}
                      verificationId={
                        discussionSummary.verificationId ?? undefined
                      }
                      model={discussionSummary.model ?? undefined}
                      requestHash={
                        discussionSummary.proof?.requestHash ?? undefined
                      }
                      responseHash={
                        discussionSummary.proof?.responseHash ?? undefined
                      }
                      nonce={
                        discussionSummary.proof?.nonce ??
                        expectations.nonce ??
                        undefined
                      }
                      expectedArch={
                        discussionSummary.proof?.arch ??
                        expectations.arch ??
                        undefined
                      }
                      expectedDeviceCertHash={
                        discussionSummary.proof?.deviceCertHash ??
                        expectations.deviceCertHash ??
                        undefined
                      }
                      expectedRimHash={
                        discussionSummary.proof?.rimHash ??
                        expectations.rimHash ??
                        undefined
                      }
                      expectedUeid={
                        discussionSummary.proof?.ueid ??
                        expectations.ueid ??
                        undefined
                      }
                      expectedMeasurements={
                        discussionSummary.proof?.measurements ??
                        expectations.measurements ??
                        undefined
                      }
                      prefetchedProof={
                        discussionSummary.remoteProof ?? undefined
                      }
                    />
                  );
                })()}
              </AlertDescription>
            </Alert>
          )}

          {showReplies && (
            <div className="space-y-4">
              {replies.map((reply) => (
                <ReplyCard
                  key={reply.id}
                  reply={reply}
                  discourseUrl={discourseUrl}
                  summary={replySummaries[reply.id]}
                  loading={replySummaryLoading[reply.id]}
                  error={replySummaryErrors[reply.id]}
                  onSummarize={() => onFetchReplySummary(reply.id)}
                  onHideSummary={() => onHideReplySummary(reply.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
