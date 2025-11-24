import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import DOMPurify from "dompurify";
import ProposalContent from "@/components/proposal/ProposalContent";
import { ScreeningBadge } from "@/components/proposal/screening/ScreeningBadge";
import { ScreeningButton } from "@/components/proposal/screening/ScreeningButton";
import { Markdown } from "@/components/proposal/Markdown";
import { VerificationProof } from "@/components/verification/VerificationProof";
import { ProposalChatbot } from "@/components/proposal/ProposalChatbot";
import { useNear } from "@/hooks/useNear";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";
import { reconstructRevisionContent } from "@/utils/revisionContentUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { extractExpectationsFromProposal } from "@/utils/attestation-expectations";
import {
  ExternalLink,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Glasses,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  MessagesSquare,
  ArrowLeft,
} from "lucide-react";
import { buildRateLimitMessage } from "@/utils/rateLimitHelpers";
import { servicesConfig } from "@/config/services";
import type {
  ProposalDetailResponse,
  ProposalReply,
  ProposalRevision,
} from "@/types/proposals";
import type { DiscourseRevisionResponse } from "@/types/discourse";
import type {
  DiscussionSummaryResponse,
  ProposalRevisionSummaryResponse,
  ReplySummaryResponse,
  TextSummaryResponse,
} from "@/types/summaries";
import { useGovernanceAnalytics } from "@/lib/analytics";

interface ScreeningData {
  evaluation: Evaluation;
  title: string;
  nearAccount: string;
  timestamp: string;
  revisionNumber: number;
  qualityScore: number;
  attentionScore: number;
  model?: string;
  verification?: VerificationMetadata | null;
  verificationId?: string | null;
}

export default function ProposalDetail() {
  const DISCOURSE_BASE_URL = servicesConfig.discourseBaseUrl;
  const router = useRouter();
  const { id } = router.query;
  const [proposal, setProposal] = useState<ProposalDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [screening, setScreening] = useState<ScreeningData | null>(null);
  const [screeningChecked, setScreeningChecked] = useState(false);
  const [currentRevision, setCurrentRevision] = useState<number>(1);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showReplies, setShowReplies] = useState(true);
  const [revisions, setRevisions] = useState<ProposalRevision[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [showDiffHighlights, setShowDiffHighlights] = useState(false);
  const [versionContent, setVersionContent] = useState<string>("");
  const [versionDiffHtml, setVersionDiffHtml] = useState<string>("");
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [proposalSummary, setProposalSummary] =
    useState<TextSummaryResponse | null>(null);
  const [proposalSummaryLoading, setProposalSummaryLoading] = useState(false);
  const [proposalSummaryError, setProposalSummaryError] = useState("");
  const [revisionSummary, setRevisionSummary] =
    useState<ProposalRevisionSummaryResponse | null>(null);
  const [revisionSummaryLoading, setRevisionSummaryLoading] = useState(false);
  const [revisionSummaryError, setRevisionSummaryError] = useState("");
  const [replySummaries, setReplySummaries] = useState<
    Record<number, ReplySummaryResponse>
  >({});
  const [replySummaryLoading, setReplySummaryLoading] = useState<
    Record<number, boolean>
  >({});
  const [replySummaryErrors, setReplySummaryErrors] = useState<
    Record<number, string>
  >({});
  const [discussionSummary, setDiscussionSummary] =
    useState<DiscussionSummaryResponse | null>(null);
  const [discussionSummaryVisible, setDiscussionSummaryVisible] =
    useState(false);
  const [discussionSummaryLoading, setDiscussionSummaryLoading] =
    useState(false);
  const [discussionSummaryError, setDiscussionSummaryError] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);

  const { wallet, signedAccountId } = useNear();
  const track = useGovernanceAnalytics();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isDesktop) {
      setShowReplies(true);
    }
  }, [isDesktop]);

  useEffect(() => {
    if (id) {
      fetchProposal(id as string);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchProposal = async (proposalId: string) => {
    try {
      const response = await fetch(`/api/proposals/${proposalId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch proposal");
      }
      const data: ProposalDetailResponse = await response.json();
      setProposal(data);
      setVersionContent(data.contentWithoutFrontmatter);

      const initialRevision = data.version || 1;
      setCurrentRevision(initialRevision);
      setSelectedVersion(initialRevision);
      fetchScreening(proposalId, initialRevision);

      track("proposal_viewed", {
        props: {
          topic_id: proposalId,
          category: data.metadata?.category ?? null,
          reply_count: data.reply_count,
        },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch proposal";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRevisions = async (proposalId: string) => {
    setRevisionsLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/revisions`);
      if (!res.ok) throw new Error("Failed to fetch revisions");
      const data: DiscourseRevisionResponse = await res.json();
      const latestRevision = data.current_version || 1;
      setCurrentRevision(latestRevision);
      setSelectedVersion(latestRevision);

      if (Array.isArray(data.revisions) && data.revisions.length > 0) {
        setRevisions(data.revisions);
        const currentRevisionData = data.revisions.find(
          (r: ProposalRevision) => r.version === latestRevision
        );

        console.log("Latest revision:", latestRevision);
        console.log("Found revision data:", !!currentRevisionData);
        console.log(
          "Has inline diff:",
          !!currentRevisionData?.body_changes?.inline
        );
        console.log(
          "Diff length:",
          currentRevisionData?.body_changes?.inline?.length
        );

        if (latestRevision > 1 && currentRevisionData) {
          try {
            const { content: reconstructedContent } =
              reconstructRevisionContent(
                proposal?.contentWithoutFrontmatter || "",
                proposal?.title || "",
                data.revisions,
                latestRevision
              );
            setVersionContent(reconstructedContent);
          } catch (error) {
            console.error("Error reconstructing latest content:", error);
          }
        }

        if (currentRevisionData?.body_changes?.inline) {
          console.log("Setting versionDiffHtml");
          setVersionDiffHtml(currentRevisionData.body_changes.inline);
        } else {
          console.log("Clearing versionDiffHtml");
          setVersionDiffHtml("");
        }
      } else {
        setRevisions([]);
        setVersionDiffHtml("");
      }
      await fetchScreening(proposalId, latestRevision);
    } catch (err: unknown) {
      console.error("Error fetching revisions:", err);
      const message =
        err instanceof Error ? err.message : "Failed to fetch revisions";
      setError(message);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const fetchScreening = async (topicId: string, revisionNumber: number) => {
    try {
      const response = await fetch(
        `/api/getAnalysis/${topicId}?revisionNumber=${revisionNumber}`
      );
      if (response.status === 404) {
        setScreening(null);
      } else if (response.ok) {
        const data = await response.json();
        const normalized = {
          ...data,
          model: data.model ?? data.evaluation?.model ?? undefined,
        };
        setScreening(normalized);
      } else {
        console.error("Unexpected error fetching screening:", response.status);
      }
    } catch (error) {
      console.error("Failed to fetch screening:", error);
    } finally {
      setScreeningChecked(true);
    }
  };

  const handleVersionChange = async (version: number) => {
    setSelectedVersion(version);
    setRevisionSummary(null);

    if (version === currentRevision) {
      setVersionContent(proposal?.contentWithoutFrontmatter || "");
      const latestRevision = revisions.find((r) => r.version === version);
      if (latestRevision && latestRevision.body_changes?.inline) {
        setVersionDiffHtml(latestRevision.body_changes.inline);
      } else {
        setVersionDiffHtml("");
      }
    } else {
      try {
        const { content: reconstructedContent } = reconstructRevisionContent(
          proposal?.contentWithoutFrontmatter || "",
          proposal?.title || "",
          revisions,
          version
        );
        setVersionContent(reconstructedContent);
        const revision = revisions.find((r) => r.version === version);
        if (revision && revision.body_changes?.inline) {
          setVersionDiffHtml(revision.body_changes.inline);
        } else {
          setVersionDiffHtml("");
        }
      } catch (error) {
        console.error("Error reconstructing content:", error);
        setVersionContent(proposal?.contentWithoutFrontmatter || "");
        setVersionDiffHtml("");
      }
    }

    if (id) {
      fetchScreening(id as string, version);
    }
  };

  const handleToggleRevisions = async () => {
    const next = !showRevisions;
    setShowRevisions(next);
    if (next && revisions.length === 0 && id) {
      await fetchRevisions(id as string);
    }
  };

  const parseErrorResponse = async (
    response: Response,
    defaultMessage: string
  ) => {
    try {
      const data = await response.json();
      if (response.status === 429) {
        return buildRateLimitMessage(response, data?.retryAfter ?? null);
      }
      return data?.message || data?.error || defaultMessage;
    } catch {
      if (response.status === 429) {
        return buildRateLimitMessage(response);
      }
      return defaultMessage;
    }
  };

  const fetchProposalSummary = async () => {
    if (!id) return;
    const topicId = String(id);
    setProposalSummaryLoading(true);
    setProposalSummaryError("");

    track("proposal_summary_requested", {
      props: { topic_id: topicId },
    });

    try {
      const response = await fetch(`/api/proposals/${id}/summarize`, {
        method: "POST",
      });
      if (response.ok) {
        const data: TextSummaryResponse = await response.json();
        setProposalSummary(data);
        setProposalSummaryError("");

        track("proposal_summary_succeeded", {
          props: { topic_id: topicId },
        });
      } else {
        const message = await parseErrorResponse(
          response,
          "Failed to fetch proposal summary"
        );
        setProposalSummaryError(message);
        console.error(message);

        track("proposal_summary_failed", {
          props: {
            topic_id: topicId,
            message: message.slice(0, 120),
          },
        });
      }
    } catch (error) {
      console.error("Error fetching proposal summary:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch proposal summary";
      setProposalSummaryError(message);

      track("proposal_summary_failed", {
        props: {
          topic_id: topicId,
          message: message.slice(0, 120),
        },
      });
    } finally {
      setProposalSummaryLoading(false);
    }
  };

  const fetchRevisionSummary = async () => {
    if (!id) return;
    const topicId = String(id);
    setRevisionSummaryLoading(true);
    setRevisionSummaryError("");

    track("proposal_revision_summary_requested", {
      props: {
        topic_id: topicId,
        revision: selectedVersion,
      },
    });

    try {
      const response = await fetch(`/api/proposals/${id}/revisions/summarize`, {
        method: "POST",
      });
      if (response.ok) {
        const data: ProposalRevisionSummaryResponse = await response.json();
        setRevisionSummary(data);
        setRevisionSummaryError("");

        track("proposal_revision_summary_succeeded", {
          props: {
            topic_id: topicId,
            revision: selectedVersion,
          },
        });
      } else {
        const message = await parseErrorResponse(
          response,
          "Failed to fetch revision summary"
        );
        setRevisionSummaryError(message);
        console.error(message);

        track("proposal_revision_summary_failed", {
          props: {
            topic_id: topicId,
            revision: selectedVersion,
            message: message.slice(0, 120),
          },
        });
      }
    } catch (error) {
      console.error("Error fetching revision summary:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch revision summary";
      setRevisionSummaryError(message);

      track("proposal_revision_summary_failed", {
        props: {
          topic_id: topicId,
          revision: selectedVersion,
          message: message.slice(0, 120),
        },
      });
    } finally {
      setRevisionSummaryLoading(false);
    }
  };

  const fetchReplySummary = async (replyId: number) => {
    if (!id) return;
    const topicId = String(id);

    setReplySummaryLoading((prev) => ({ ...prev, [replyId]: true }));
    setReplySummaryErrors((prev) => ({ ...prev, [replyId]: "" }));

    track("proposal_reply_summary_requested", {
      props: {
        topic_id: topicId,
        reply_id: replyId,
      },
    });

    try {
      const response = await fetch(
        `/api/discourse/replies/${replyId}/summarize`,
        {
          method: "POST",
        }
      );
      if (response.ok) {
        const data: ReplySummaryResponse = await response.json();
        setReplySummaries((prev) => ({ ...prev, [replyId]: data }));
        setReplySummaryErrors((prev) => ({ ...prev, [replyId]: "" }));

        track("proposal_reply_summary_succeeded", {
          props: {
            topic_id: topicId,
            reply_id: replyId,
          },
        });
      } else {
        const message = await parseErrorResponse(
          response,
          "Failed to fetch reply summary"
        );
        setReplySummaryErrors((prev) => ({ ...prev, [replyId]: message }));
        console.error(message);

        track("proposal_reply_summary_failed", {
          props: {
            topic_id: topicId,
            reply_id: replyId,
            message: message.slice(0, 120),
          },
        });
      }
    } catch (error) {
      console.error("Error fetching reply summary:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch reply summary";

      setReplySummaryErrors((prev) => ({
        ...prev,
        [replyId]: message,
      }));

      track("proposal_reply_summary_failed", {
        props: {
          topic_id: topicId,
          reply_id: replyId,
          message: message.slice(0, 120),
        },
      });
    } finally {
      setReplySummaryLoading((prev) => ({ ...prev, [replyId]: false }));
    }
  };

  const getDaysSinceActivity = (lastPostedAt: string) => {
    const now = new Date();
    const lastActivity = new Date(lastPostedAt);
    const diffTime = Math.abs(now.getTime() - lastActivity.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const formatScore = (score: number) => {
    return `${(score * 100).toFixed(0)}%`;
  };

  const handleDiscussionSummary = async () => {
    if (!id) return;
    const topicId = String(id);

    if (discussionSummary) {
      const nextVisible = !discussionSummaryVisible;
      setDiscussionSummaryVisible(nextVisible);

      track("proposal_discussion_summary_toggled", {
        props: {
          topic_id: topicId,
          visible: nextVisible,
        },
      });
      return;
    }

    setDiscussionSummaryLoading(true);
    setDiscussionSummaryError("");

    track("proposal_discussion_summary_requested", {
      props: { topic_id: topicId },
    });

    try {
      const response = await fetch(`/api/discourse/topics/${id}/summarize`, {
        method: "POST",
      });
      if (!response.ok) {
        const message = await parseErrorResponse(
          response,
          "Failed to generate summary"
        );
        throw new Error(message);
      }
      const data: DiscussionSummaryResponse = await response.json();
      setDiscussionSummary(data);
      setDiscussionSummaryVisible(true);

      track("proposal_discussion_summary_succeeded", {
        props: { topic_id: topicId },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate summary";
      setDiscussionSummaryError(message);

      track("proposal_discussion_summary_failed", {
        props: {
          topic_id: topicId,
          message: message.slice(0, 120),
        },
      });
    } finally {
      setDiscussionSummaryLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto p-8">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-32 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto p-8">
          <Alert variant="destructive">
            <AlertDescription>{error || "Proposal not found"}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const daysSinceActivity = getDaysSinceActivity(proposal.last_posted_at);

  // Create a description from content or title
  const description = proposal.contentWithoutFrontmatter
    ? proposal.contentWithoutFrontmatter.slice(0, 160).trim() + "..."
    : proposal.title;

  return (
    <>
      <Head>
        <title>{proposal.title} | NEAR Governance</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={proposal.title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="article" />
      </Head>

      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl px-4 pt-6 pb-10 sm:px-6 lg:px-8 lg:pt-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="mb-4 gap-2 hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Proposals
          </Button>

          <Card className="mb-6 sm:mb-8">
            <CardHeader className="space-y-4">
              {/* Title + category */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <CardTitle className="text-2xl leading-tight sm:text-3xl md:text-4xl">
                  {proposal.title}
                </CardTitle>

                {proposal.metadata?.category && (
                  <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                    {proposal.metadata.category}
                  </span>
                )}
              </div>

              {/* Meta row */}
              <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                {/* left cluster: author, wallet, date, view on discourse */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-foreground">
                    @{proposal.username}
                  </span>

                  {proposal.near_wallet && (
                    <>
                      <Separator
                        orientation="vertical"
                        className="hidden h-4 sm:block"
                      />
                      <span>{proposal.near_wallet}</span>
                    </>
                  )}

                  <Separator
                    orientation="vertical"
                    className="hidden h-4 sm:block"
                  />
                  <span>
                    {new Date(proposal.created_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>

                  <Separator
                    orientation="vertical"
                    className="hidden h-4 sm:block"
                  />
                  <a
                    href={`${DISCOURSE_BASE_URL}/t/${proposal.topic_slug}/${proposal.topic_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    View on Discourse
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                {/* right cluster: replies + last activity */}
                <div className="flex items-center gap-4 sm:justify-end">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    <span className="font-semibold text-foreground">
                      {formatNumber(proposal.reply_count)}
                    </span>
                    <span>replies</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <span className="font-semibold text-foreground">
                      {daysSinceActivity}d
                    </span>
                    <span>ago</span>
                  </div>
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
            <div className="space-y-8 min-h-0">
              <Card className="rounded-2xl border-border/60 shadow-sm">
                <ProposalContent
                  content={
                    versionContent || proposal.contentWithoutFrontmatter || ""
                  }
                  metadata={proposal.metadata || {}}
                  isExpanded={isContentExpanded}
                  onToggleExpand={setIsContentExpanded}
                  proposalSummary={proposalSummary}
                  proposalSummaryLoading={proposalSummaryLoading}
                  proposalSummaryError={proposalSummaryError}
                  onFetchProposalSummary={fetchProposalSummary}
                  onHideProposalSummary={() => setProposalSummary(null)}
                  showRevisions={showRevisions}
                  onToggleRevisions={handleToggleRevisions}
                  hasRevisions={currentRevision > 1}
                  currentRevision={currentRevision}
                  revisionCount={revisions.length}
                  showDiffHighlights={showDiffHighlights}
                  versionDiffHtml={versionDiffHtml}
                  revisions={revisions}
                  selectedVersion={selectedVersion}
                  onVersionChange={handleVersionChange}
                  onToggleDiff={setShowDiffHighlights}
                  onSummarizeChanges={fetchRevisionSummary}
                  revisionSummary={revisionSummary}
                  revisionSummaryLoading={revisionSummaryLoading}
                  revisionSummaryError={revisionSummaryError}
                  onHideRevisionSummary={() => setRevisionSummary(null)}
                />
              </Card>

              {proposal.replies && proposal.replies.length > 0 && (
                <Card className="rounded-2xl border-border/60 shadow-sm">
                  <div
                    className={`lg:sticky lg:top-16 z-20 bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)] ${
                      showReplies ||
                      (discussionSummary && discussionSummaryVisible)
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
                            onClick={handleDiscussionSummary}
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
                                <Loader2 className="h-4 w-4 animate-spin" />{" "}
                                Generating...
                              </>
                            ) : discussionSummary ? (
                              discussionSummaryVisible ? (
                                <>
                                  <ChevronUp className="h-4 w-4" /> Hide Summary
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-4 w-4" /> Show
                                  Summary
                                </>
                              )
                            ) : (
                              <>Summarize</>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowReplies((prev) => !prev)}
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
                            Replies ({proposal.replies.length})
                          </Button>
                        </div>
                      </div>
                      {discussionSummaryError && (
                        <Alert variant="destructive" className="mt-4">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            {discussionSummaryError}
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardHeader>
                  </div>

                  {(showReplies ||
                    (discussionSummary && discussionSummaryVisible)) && (
                    <CardContent className="pt-6 space-y-4">
                      {discussionSummary && discussionSummaryVisible && (
                        <Alert className="bg-blue-50 border-blue-200">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="secondary">
                              Discussion Summary
                            </Badge>
                          </div>
                          <AlertDescription className="space-y-4">
                            <Markdown
                              content={discussionSummary.summary}
                              className="text-sm leading-relaxed"
                            />
                            {(() => {
                              const expectations =
                                extractExpectationsFromProposal(
                                  discussionSummary
                                );
                              return (
                                <VerificationProof
                                  verification={
                                    discussionSummary.verification ?? undefined
                                  }
                                  verificationId={
                                    discussionSummary.verificationId ??
                                    undefined
                                  }
                                  model={discussionSummary.model ?? undefined}
                                  requestHash={
                                    discussionSummary.proof?.requestHash ??
                                    undefined
                                  }
                                  responseHash={
                                    discussionSummary.proof?.responseHash ??
                                    undefined
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
                          {proposal.replies.map((reply) => {
                            const replySummary = replySummaries[reply.id];
                            return (
                              <Card key={reply.id} className="bg-muted/50">
                                <CardContent className="pt-6">
                                  <div className="flex justify-between items-start mb-3 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-3">
                                      {reply.avatar_template ? (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img
                                          src={`${DISCOURSE_BASE_URL}${reply.avatar_template.replace(
                                            "{size}",
                                            "48"
                                          )}`}
                                          alt={`${reply.username} avatar`}
                                          className="w-10 h-10 rounded-full"
                                          onError={(e) => {
                                            // Fallback to initials if image fails to load
                                            const target =
                                              e.target as HTMLImageElement;
                                            target.style.display = "none";
                                            if (target.nextElementSibling) {
                                              (
                                                target.nextElementSibling as HTMLElement
                                              ).style.display = "flex";
                                            }
                                          }}
                                        />
                                      ) : null}
                                      <div
                                        className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary"
                                        style={{
                                          display: reply.avatar_template
                                            ? "none"
                                            : "flex",
                                        }}
                                      >
                                        {reply.username
                                          .substring(0, 2)
                                          .toUpperCase()}
                                      </div>
                                      <div>
                                        <span className="font-semibold text-foreground">
                                          @{reply.username}
                                        </span>
                                        <span className="ml-2">
                                          #{reply.post_number}
                                        </span>
                                      </div>
                                    </div>
                                    <div>
                                      {new Date(
                                        reply.created_at
                                      ).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </div>
                                  </div>

                                  <div
                                    className="prose prose-sm max-w-none mb-3
                                [&_aside.quote]:border-l-4 [&_aside.quote]:border-primary/30 [&_aside.quote]:pl-4 [&_aside.quote]:py-2 [&_aside.quote]:bg-muted/30 [&_aside.quote]:rounded-r [&_aside.quote]:my-3
                                [&_aside.quote_.title]:flex [&_aside.quote_.title]:items-center [&_aside.quote_.title]:gap-2 [&_aside.quote_.title]:mb-2 [&_aside.quote_.title]:font-semibold [&_aside.quote_.title]:text-sm [&_aside.quote_.title]:text-foreground
                                [&_aside.quote_img.avatar]:w-6 [&_aside.quote_img.avatar]:h-6 [&_aside.quote_img.avatar]:rounded-full [&_aside.quote_img.avatar]:inline-block
                                [&_img.emoji]:inline [&_img.emoji]:align-middle [&_img.emoji]:w-5 [&_img.emoji]:h-5 [&_img.emoji]:mx-0"
                                    dangerouslySetInnerHTML={{
                                      __html: DOMPurify.sanitize(
                                        reply.cooked
                                          .replace(
                                            /href="\/u\//g,
                                            `href="${DISCOURSE_BASE_URL}/u/"`
                                          )
                                          .replace(
                                            /href="\/t\//g,
                                            `href="${DISCOURSE_BASE_URL}/t/"`
                                          )
                                          .replace(
                                            /href="\/c\//g,
                                            `href="${DISCOURSE_BASE_URL}/c/"`
                                          )
                                          .replace(
                                            /src="\/user_avatar\//g,
                                            `src="${DISCOURSE_BASE_URL}/user_avatar/"`
                                          ),
                                        {
                                          ALLOWED_TAGS: [
                                            "p",
                                            "br",
                                            "span",
                                            "div",
                                            "strong",
                                            "em",
                                            "u",
                                            "s",
                                            "del",
                                            "ins",
                                            "h1",
                                            "h2",
                                            "h3",
                                            "h4",
                                            "h5",
                                            "h6",
                                            "ul",
                                            "ol",
                                            "li",
                                            "a",
                                            "img",
                                            "blockquote",
                                            "aside",
                                            "pre",
                                            "code",
                                            "table",
                                            "thead",
                                            "tbody",
                                            "tr",
                                            "th",
                                            "td",
                                          ],
                                          ALLOWED_ATTR: [
                                            "href",
                                            "src",
                                            "alt",
                                            "title",
                                            "class",
                                            "style",
                                            "data-username",
                                            "data-post-id",
                                            "data-user-id",
                                          ],
                                          ALLOWED_URI_REGEXP:
                                            /^(?:https?:|mailto:|data:image\/|\/)/i,
                                          FORBID_TAGS: [
                                            "script",
                                            "iframe",
                                            "object",
                                            "embed",
                                            "form",
                                            "input",
                                            "button",
                                          ],
                                          FORBID_ATTR: [
                                            "onerror",
                                            "onload",
                                            "onclick",
                                            "onmouseover",
                                            "onmouseout",
                                            "onfocus",
                                            "onblur",
                                          ],
                                        }
                                      ),
                                    }}
                                  />

                                  {!replySummary ? (
                                    <>
                                      <Button
                                        variant="default"
                                        size="sm"
                                        onClick={() =>
                                          fetchReplySummary(reply.id)
                                        }
                                        disabled={replySummaryLoading[reply.id]}
                                      >
                                        {replySummaryLoading[reply.id]
                                          ? "Summarizing..."
                                          : "Summarize"}
                                      </Button>
                                      {replySummaryErrors[reply.id] && (
                                        <Alert className="bg-red-50 border-red-200 text-red-900 mt-3">
                                          <AlertDescription>
                                            {replySummaryErrors[reply.id]}
                                          </AlertDescription>
                                        </Alert>
                                      )}
                                    </>
                                  ) : (
                                    <Alert className="bg-orange-50 border-orange-200 mt-3">
                                      <AlertDescription>
                                        <div className="flex justify-between items-center mb-2">
                                          <span className="font-semibold text-orange-900 text-xs">
                                            Summary
                                          </span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 text-xs"
                                            onClick={() => {
                                              setReplySummaries((prev) => {
                                                const newSummaries = {
                                                  ...prev,
                                                };
                                                delete newSummaries[reply.id];
                                                return newSummaries;
                                              });
                                              setReplySummaryErrors((prev) => {
                                                const next = { ...prev };
                                                delete next[reply.id];
                                                return next;
                                              });
                                            }}
                                          >
                                            Hide
                                          </Button>
                                        </div>
                                        <Markdown
                                          content={replySummary.summary}
                                          className="text-xs"
                                        />
                                        {(() => {
                                          const expectations =
                                            extractExpectationsFromProposal(
                                              replySummary
                                            );
                                          return (
                                            <VerificationProof
                                              verification={
                                                replySummary.verification ??
                                                undefined
                                              }
                                              verificationId={
                                                replySummary.verificationId ??
                                                undefined
                                              }
                                              model={
                                                replySummary.model ?? undefined
                                              }
                                              requestHash={
                                                replySummary.proof
                                                  ?.requestHash ?? undefined
                                              }
                                              responseHash={
                                                replySummary.proof
                                                  ?.responseHash ?? undefined
                                              }
                                              nonce={
                                                replySummary.proof?.nonce ??
                                                expectations.nonce ??
                                                undefined
                                              }
                                              expectedArch={
                                                replySummary.proof?.arch ??
                                                expectations.arch ??
                                                undefined
                                              }
                                              expectedDeviceCertHash={
                                                replySummary.proof
                                                  ?.deviceCertHash ??
                                                expectations.deviceCertHash ??
                                                undefined
                                              }
                                              expectedRimHash={
                                                replySummary.proof?.rimHash ??
                                                expectations.rimHash ??
                                                undefined
                                              }
                                              expectedUeid={
                                                replySummary.proof?.ueid ??
                                                expectations.ueid ??
                                                undefined
                                              }
                                              expectedMeasurements={
                                                replySummary.proof
                                                  ?.measurements ??
                                                expectations.measurements ??
                                                undefined
                                              }
                                              className="mt-2"
                                              prefetchedProof={
                                                replySummary.remoteProof ??
                                                undefined
                                              }
                                            />
                                          );
                                        })()}
                                      </AlertDescription>
                                    </Alert>
                                  )}
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <div className="lg:sticky lg:top-8 space-y-6">
                {screeningChecked &&
                  screening &&
                  screening.revisionNumber === selectedVersion && (
                    <ScreeningBadge
                      screening={screening}
                      verification={screening.verification ?? undefined}
                      verificationId={screening.verificationId ?? undefined}
                    />
                  )}

                {screeningChecked &&
                  (!screening ||
                    screening.revisionNumber !== selectedVersion) &&
                  wallet &&
                  signedAccountId && (
                    <ScreeningButton
                      topicId={id as string}
                      title={proposal.title}
                      content={proposal.content}
                      revisionNumber={selectedVersion}
                      onScreeningComplete={() =>
                        fetchScreening(id as string, selectedVersion)
                      }
                    />
                  )}

                {screeningChecked &&
                  (!screening ||
                    screening.revisionNumber !== selectedVersion) &&
                  (!wallet || !signedAccountId) && (
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">
                          Connect your NEAR wallet to evaluate this proposal.
                        </p>
                      </CardContent>
                    </Card>
                  )}

                <ProposalChatbot
                  proposalTitle={proposal.title}
                  proposalContent={proposal.content}
                  proposalId={id as string}
                  replies={proposal.replies ?? []}
                  proposalAuthor={proposal.username}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
