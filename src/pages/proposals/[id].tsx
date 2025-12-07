import { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { ArrowLeft, Clock, ExternalLink, MessageSquare } from "lucide-react";
import ProposalContent from "@/components/proposal/ProposalContent";
import { DiscussionSection } from "@/components/proposal/DiscussionSection";
import { ProposalChatbot } from "@/components/proposal/ProposalChatbot";
import { ScreeningBadge } from "@/components/proposal/screening/ScreeningBadge";
import { ScreeningButton } from "@/components/proposal/screening/ScreeningButton";
import { useProposalDetail } from "@/hooks/useProposalDetail";
import { useProposalSummaries } from "@/hooks/useProposalSummaries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { servicesConfig } from "@/config/services";
import { useNear } from "@/hooks/useNear";
import { useGovernanceAnalytics } from "@/lib/analytics";

const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

const getDaysSinceActivity = (lastPostedAt: string) => {
  const now = new Date();
  const lastActivity = new Date(lastPostedAt);
  const diffTime = Math.abs(now.getTime() - lastActivity.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

const formatNumber = (num: number) => {
  return num.toLocaleString();
};

export default function ProposalDetail() {
  const router = useRouter();
  const { id } = router.query;
  const track = useGovernanceAnalytics();
  const { wallet, signedAccountId } = useNear();
  const [isDesktop, setIsDesktop] = useState(false);
  const [showReplies, setShowReplies] = useState(true);
  const [isContentExpanded, setIsContentExpanded] = useState(false);

  const {
    proposal,
    loading,
    error,
    screening,
    screeningChecked,
    currentRevision,
    showRevisions,
    showDiffHighlights,
    setShowDiffHighlights,
    selectedVersion,
    versionContent,
    versionDiffHtml,
    revisions,
    handleVersionChange,
    handleToggleRevisions,
    fetchScreening,
  } = useProposalDetail({
    proposalId: id as string | undefined,
    track,
  });

  const {
    proposalSummary,
    proposalSummaryLoading,
    proposalSummaryError,
    fetchProposalSummary,
    setProposalSummary,
    revisionSummary,
    revisionSummaryLoading,
    revisionSummaryError,
    fetchRevisionSummary,
    setRevisionSummary,
    replySummaries,
    replySummaryLoading,
    replySummaryErrors,
    fetchReplySummary,
    hideReplySummary,
    discussionSummary,
    discussionSummaryVisible,
    discussionSummaryLoading,
    discussionSummaryError,
    handleDiscussionSummary,
  } = useProposalSummaries({
    proposalId: id as string | undefined,
    selectedVersion,
    track,
  });

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
            onClick={() => router.push("/proposals")}
            className="mb-4 gap-2 hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Proposals
          </Button>

          <Card className="mb-6 sm:mb-8">
            <CardHeader className="space-y-4">
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

              <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
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
                    href={`${DISCOURSE_URL}/t/${proposal.topic_slug}/${proposal.topic_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    View on Discourse
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

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

              <DiscussionSection
                discourseBaseUrl={DISCOURSE_URL}
                replies={proposal.replies ?? []}
                discussionSummary={discussionSummary}
                discussionSummaryVisible={discussionSummaryVisible}
                discussionSummaryLoading={discussionSummaryLoading}
                discussionSummaryError={discussionSummaryError}
                showReplies={showReplies}
                onToggleReplies={() => setShowReplies((prev) => !prev)}
                onHandleDiscussionSummary={handleDiscussionSummary}
                replySummaries={replySummaries}
                replySummaryLoading={replySummaryLoading}
                replySummaryErrors={replySummaryErrors}
                onFetchReplySummary={fetchReplySummary}
                onHideReplySummary={hideReplySummary}
              />
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
