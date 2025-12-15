import { useState } from "react";
import type { Evaluation } from "@/types/evaluation";
import type { ProposalRevision } from "@/components/proposal/types/proposals";
import type { DiscourseRevisionResponse } from "@/types/discourse";
import type { VerificationMetadata } from "@/types/agui-events";
import { ScreeningBadge } from "@/components/proposal/screening/ScreeningBadge";
import { reconstructRevisionContent } from "@/utils/ui/revision-content";
import { sanitizeHtml, stripHtml } from "@/utils/ui/html";
import { useGovernanceAnalytics } from "@/lib/analytics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  History,
  ChevronDown,
  ChevronUp,
  Loader2,
  User,
  Calendar,
  FileEdit,
} from "lucide-react";
import { useNear } from "@/hooks/useNear";
import { NearErrorAlert } from "@/components/ui/NearErrorAlert";
import { logger } from "@/lib/logger";
import {
  createNearOperationError,
  logNearError,
  type NearOperationError,
} from "@/utils/errors/near-errors";
import { handleScreeningResponse } from "@/utils/errors/screening-errors";
import { screenProposalRevision } from "@/utils/screening/screen-proposal";

interface VersionHistoryProps {
  proposalId: string;
  title: string;
  content: string;
}

const isTestEnvironment =
  typeof process !== "undefined" && process.env.NODE_ENV === "test";

const SCREENING_PAGE_LIMIT = 50;
const MAX_SCREENING_PAGES = 12;

export default function VersionHistory({
  proposalId,
  title,
  content,
}: VersionHistoryProps) {
  const track = useGovernanceAnalytics();
  const { signedAccountId, walletSigner, signIn } = useNear();

  const [revisions, setRevisions] = useState<ProposalRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<NearOperationError | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [screeningRevision, setScreeningRevision] = useState<number | null>(
    null
  );
  const [screeningResults, setScreeningResults] = useState<
    Record<
      number,
      {
        evaluation: Evaluation;
        nearAccount: string;
        timestamp: string;
        verification?: VerificationMetadata | null;
        verificationId?: string | null;
        model?: string | null;
      }
    >
  >({});
  const [screeningErrors, setScreeningErrors] = useState<
    Record<number, NearOperationError | null>
  >({});

  const fetchRevisions = async () => {
    if (revisions.length > 0) {
      setShowHistory(!showHistory);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/proposals/${proposalId}/revisions`);

      if (!response.ok) {
        throw new Error("Failed to fetch version history");
      }

      const data: DiscourseRevisionResponse = await response.json();
      const fetchedRevisions = [...(data.revisions || [])].reverse();
      setRevisions(fetchedRevisions);

      if (!isTestEnvironment) {
        await fetchExistingScreenings();
      }

      setShowHistory(true);
    } catch (err: unknown) {
      const nearError = createNearOperationError(err);
      logNearError("VersionHistory.fetchRevisions", nearError);
      setError(nearError);
    } finally {
      setLoading(false);
    }
  };

  const fetchExistingScreenings = async () => {
    try {
      type ScreeningPageData = {
        results?: Array<{
          revisionNumber?: number;
          evaluation?: Evaluation;
          nearAccount?: string;
          timestamp?: string;
          model?: string | null;
        }>;
        screenings?: Array<{
          revisionNumber?: number;
          evaluation?: Evaluation;
          nearAccount?: string;
          timestamp?: string;
          model?: string | null;
        }>;
        hasMore?: boolean;
        nextCursor?: string;
      };

      const aggregated: ScreeningPageData["results"] = [];
      let cursor: string | undefined;
      let pageCount = 0;

      while (pageCount < MAX_SCREENING_PAGES) {
        const params = new URLSearchParams({
          all: "true",
          limit: String(SCREENING_PAGE_LIMIT),
        });
        if (cursor) {
          params.set("cursor", cursor);
        }

        const response = await fetch(
          `/api/getAnalysis/${proposalId}?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch existing screenings");
        }

        const data: ScreeningPageData = await response.json();
        const pageResults =
          Array.isArray(data.results) && data.results.length
            ? data.results
            : Array.isArray(data.screenings)
            ? data.screenings
            : [];

        if (!pageResults.length) {
          break;
        }

        aggregated.push(...pageResults);

        if (!data.hasMore || !data.nextCursor || data.nextCursor === cursor) {
          break;
        }

        cursor = data.nextCursor;
        pageCount += 1;
      }

      if (!aggregated.length) {
        return;
      }

      const newResults: Record<
        number,
        {
          evaluation: Evaluation;
          nearAccount: string;
          timestamp: string;
          verification?: VerificationMetadata | null;
          verificationId?: string | null;
          model?: string | null;
        }
      > = {};

      for (const screening of aggregated) {
        if (
          typeof screening.revisionNumber !== "number" ||
          !screening.evaluation ||
          !screening.nearAccount ||
          !screening.timestamp
        ) {
          continue;
        }

        newResults[screening.revisionNumber] = {
          evaluation: screening.evaluation,
          nearAccount: screening.nearAccount,
          timestamp: screening.timestamp,
          verification: null,
          verificationId: null,
          model: screening.model ?? screening.evaluation.model ?? null,
        };
      }

      setScreeningResults((prev) => ({ ...prev, ...newResults }));
    } catch (err: unknown) {
      logger.error("Failed to fetch existing screenings", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleScreenRevision = async (revisionNumber: number) => {
    setScreeningRevision(revisionNumber);
    setScreeningErrors((prev) => ({ ...prev, [revisionNumber]: null }));

    track("revision_screening_started", {
      props: { topic_id: proposalId, revision: revisionNumber },
    });

    try {
      const { content: revisionContent, title: revisionTitle } =
        reconstructRevisionContent(content, title, revisions, revisionNumber);
      const { response: saveResponse, payload: parsedPayload } =
        await screenProposalRevision({
          proposalId,
          title: revisionTitle,
          content: stripHtml(revisionContent),
          revisionNumber,
          walletSigner,
          signedAccountId,
        });

      const screeningResult = handleScreeningResponse(
        saveResponse,
        {
          topicId: proposalId,
          revisionNumber,
          accountId: signedAccountId!,
        },
        parsedPayload
      );

      if (!screeningResult.success) {
        if (screeningResult.shouldTrack) {
          track(screeningResult.shouldTrack.event, {
            props: screeningResult.shouldTrack.props,
          });
        }
        const nearError =
          screeningResult.error ??
          createNearOperationError(new Error("Screening failed."));
        logNearError("VersionHistory.screenRevision", nearError);
        setScreeningErrors((prev) => ({
          ...prev,
          [revisionNumber]: nearError,
        }));
        return;
      }

      const saveData = (parsedPayload ?? {}) as {
        evaluation?: Evaluation;
        verification?: VerificationMetadata | null;
        verificationId?: string | null;
        model?: string | null;
      };
      const evaluation = saveData.evaluation;

      const verification =
        typeof saveData === "object" &&
        saveData !== null &&
        "verification" in saveData
          ? (saveData as { verification?: VerificationMetadata | null })
              .verification ?? null
          : null;
      const proofVerificationId =
        typeof saveData === "object" &&
        saveData !== null &&
        "verificationId" in saveData
          ? (saveData as { verificationId?: string | null }).verificationId ??
            null
          : null;

      if (!evaluation) {
        throw new Error("Missing evaluation data in response");
      }

      setScreeningResults((prev) => ({
        ...prev,
        [revisionNumber]: {
          evaluation,
          nearAccount: signedAccountId,
          timestamp: new Date().toISOString(),
          verification,
          verificationId:
            proofVerificationId ?? verification?.messageId ?? null,
          model: saveData.model ?? evaluation.model ?? null,
        },
      }));

      track("revision_screening_succeeded", {
        props: {
          topic_id: proposalId,
          revision: revisionNumber,
          overall_pass: evaluation.overallPass,
        },
      });
    } catch (err: unknown) {
      const nearError = createNearOperationError(err);
      logNearError("VersionHistory.screenRevision", nearError);
      setScreeningErrors((prev) => ({
        ...prev,
        [revisionNumber]: nearError,
      }));
      track("revision_screening_failed", {
        props: {
          topic_id: proposalId,
          revision: revisionNumber,
          message: nearError.message,
        },
      });
    } finally {
      setScreeningRevision(null);
    }
  };

  const renderScreeningButton = (revisionNumber: number) => {
    const isScreening = screeningRevision === revisionNumber;
    const screeningData = screeningResults[revisionNumber];
    const error = screeningErrors[revisionNumber];

    if (screeningData) {
      return (
        <div className="mt-3">
          <ScreeningBadge
            screening={{
              evaluation: screeningData.evaluation,
              title: title,
              nearAccount: screeningData.nearAccount,
              timestamp: screeningData.timestamp,
              revisionNumber: revisionNumber,
              qualityScore: screeningData.evaluation.qualityScore,
              attentionScore: screeningData.evaluation.attentionScore,
              model:
                screeningData.model ??
                screeningData.evaluation.model ??
                undefined,
            }}
          />
        </div>
      );
    }

    return (
      <div className="mt-3 space-y-2">
        <NearErrorAlert
          error={error}
          onRetry={() => {
            setScreeningErrors((prev) => ({ ...prev, [revisionNumber]: null }));
            void handleScreenRevision(revisionNumber);
          }}
          onReconnect={() => {
            setScreeningErrors((prev) => ({ ...prev, [revisionNumber]: null }));
            void signIn();
          }}
          onDismiss={() =>
            setScreeningErrors((prev) => ({ ...prev, [revisionNumber]: null }))
          }
        />
        <Button
          onClick={(e) => {
            e.stopPropagation();
            handleScreenRevision(revisionNumber);
          }}
          disabled={isScreening || !walletSigner || !signedAccountId}
          size="sm"
          variant="outline"
          className="w-full gap-2"
        >
          {isScreening ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Screening...
            </>
          ) : walletSigner && signedAccountId ? (
            "Screen This Revision"
          ) : (
            "Connect Wallet to Screen"
          )}
        </Button>
      </div>
    );
  };

  const renderDiff = (revision: ProposalRevision) => {
    if (!revision.body_changes && !revision.title_changes) {
      return (
        <p className="text-sm text-muted-foreground">No changes available</p>
      );
    }

    return (
      <div className="space-y-4">
        {revision.title_changes?.inline && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">
              Title Changes:
            </h4>
            <div
              className="text-sm"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(revision.title_changes.inline),
              }}
            />
          </div>
        )}
        {revision.body_changes?.inline && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">
              Content Changes:
            </h4>
            <div
              className="max-h-[400px] overflow-auto p-2 bg-muted rounded text-sm"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(revision.body_changes.inline),
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Version History</CardTitle>
          </div>
          <Button
            onClick={fetchRevisions}
            disabled={loading}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : showHistory ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Hide History
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                Show History
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {error && (
        <CardContent>
          <NearErrorAlert
            error={error}
            onRetry={() => void fetchRevisions()}
            onReconnect={() => void signIn()}
            onDismiss={() => setError(null)}
          />
        </CardContent>
      )}

      {showHistory && revisions.length === 0 && (
        <CardContent>
          <CardDescription>
            No edit history available - this is the original version.
          </CardDescription>
        </CardContent>
      )}

      {showHistory && revisions.length > 0 && (
        <CardContent className="space-y-3">
          {/* Revisions (newest first) */}
          {revisions.map((revision, index) => (
            <Collapsible
              key={revision.version}
              open={selectedVersion === revision.version}
              onOpenChange={(open) =>
                setSelectedVersion(open ? revision.version : null)
              }
            >
              <Card
                className={
                  selectedVersion === revision.version ? "border-primary" : ""
                }
              >
                <CollapsibleTrigger className="w-full">
                  <CardHeader>
                    <div className="flex items-center justify-between text-left">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            <span>
                              Revision {revisions.length - index} of{" "}
                              {revisions.length}
                            </span>
                          </Badge>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="h-3 w-3" />@{revision.username}
                          </div>
                        </div>
                        {revision.edit_reason && (
                          <p className="text-xs text-muted-foreground italic">
                            {revision.edit_reason}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {new Date(revision.created_at).toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="space-y-3">
                    <Separator />
                    {renderDiff(revision)}
                    {renderScreeningButton(revision.version)}
                  </CardContent>
                </CollapsibleContent>

                {selectedVersion !== revision.version && (
                  <CardContent>
                    <p className="text-xs text-primary flex items-center gap-1">
                      <ChevronDown className="h-3 w-3" />
                      Click to view changes
                    </p>
                  </CardContent>
                )}
              </Card>
            </Collapsible>
          ))}

          {/* Original Version Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Original Version (v1)</Badge>
                  <FileEdit className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <CardDescription className="text-xs">
                Initial proposal submission
              </CardDescription>
            </CardHeader>
            <CardContent>{renderScreeningButton(1)}</CardContent>
          </Card>
        </CardContent>
      )}
    </Card>
  );
}
