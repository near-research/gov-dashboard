import { useState } from "react";
import type { Evaluation } from "@/types/evaluation";
import type { ProposalRevision } from "@/types/proposals";
import type { DiscourseRevisionResponse } from "@/types/discourse";
import { ScreeningBadge } from "@/components/proposal/screening/ScreeningBadge";
import { reconstructRevisionContent } from "@/utils/revisionContentUtils";
import { sanitizeHtml, stripHtml } from "@/utils/html-utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  AlertCircle,
  User,
  Calendar,
  FileEdit,
} from "lucide-react";

interface VersionHistoryProps {
  proposalId: string;
  title: string;
  content: string;
  nearAccount: string;
  wallet: any;
}

export default function VersionHistory({
  proposalId,
  title,
  content,
  nearAccount,
  wallet,
}: VersionHistoryProps) {
  const [revisions, setRevisions] = useState<ProposalRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [screeningRevision, setScreeningRevision] = useState<number | null>(
    null
  );
  const [screeningResults, setScreeningResults] = useState<
    Record<
      number,
      { evaluation: Evaluation; nearAccount: string; timestamp: string }
    >
  >({});
  const [screeningErrors, setScreeningErrors] = useState<
    Record<number, string>
  >({});

  const fetchRevisions = async () => {
    if (revisions.length > 0) {
      setShowHistory(!showHistory);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/proposals/${proposalId}/revisions`);

      if (!response.ok) {
        throw new Error("Failed to fetch version history");
      }

      const data: DiscourseRevisionResponse = await response.json();
      const fetchedRevisions = [...(data.revisions || [])].reverse();
      setRevisions(fetchedRevisions);

      await fetchExistingScreenings([
        1,
        ...fetchedRevisions.map((r) => r.version),
      ]);

      setShowHistory(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch version history";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchExistingScreenings = async (versionNumbers: number[]) => {
    const newResults: Record<
      number,
      { evaluation: Evaluation; nearAccount: string; timestamp: string }
    > = {};

    for (const version of versionNumbers) {
      try {
        const response = await fetch(
          `/api/getAnalysis/${proposalId}?revisionNumber=${version}`
        );

        if (response.ok) {
          const data = await response.json();
          newResults[version] = {
            evaluation: data.evaluation,
            nearAccount: data.nearAccount,
            timestamp: data.timestamp,
          };
        }
      } catch (err) {
        console.error(
          `Failed to fetch screening for revision ${version}:`,
          err
        );
      }
    }

    setScreeningResults(newResults);
  };

  const handleScreenRevision = async (revisionNumber: number) => {
    setScreeningRevision(revisionNumber);
    setScreeningErrors((prev) => ({ ...prev, [revisionNumber]: "" }));

    try {
      if (!wallet) {
        throw new Error(
          "Wallet not connected. Please connect your NEAR wallet."
        );
      }

      if (!nearAccount) {
        throw new Error("NEAR account not found. Please connect your wallet.");
      }

      const { content: revisionContent, title: revisionTitle } =
        reconstructRevisionContent(content, title, revisions, revisionNumber);

      const { sign } = await import("near-sign-verify");
      const { base58 } = await import("@scure/base");

      const walletWrapper = {
        signMessage: async (params: any) => {
          const result = await wallet.signMessage(params);
          const signatureBytes = Uint8Array.from(atob(result.signature), (c) =>
            c.charCodeAt(0)
          );
          const base58Signature = base58.encode(signatureBytes);
          return { ...result, signature: `ed25519:${base58Signature}` };
        },
      };

      const authToken = await sign(
        `Evaluate proposal ${proposalId} revision ${revisionNumber}`,
        { signer: walletWrapper, recipient: "social.near" }
      );

      const saveResponse = await fetch(`/api/saveAnalysis/${proposalId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: revisionTitle,
          content: stripHtml(revisionContent),
          evaluatorAccount: nearAccount,
          revisionNumber,
        }),
      });

      const saveData = await saveResponse.json();

      if (!saveResponse.ok) {
        if (saveResponse.status === 409) {
          setScreeningErrors((prev) => ({
            ...prev,
            [revisionNumber]: "This revision has already been evaluated.",
          }));
        } else if (saveResponse.status === 429) {
          setScreeningErrors((prev) => ({
            ...prev,
            [revisionNumber]:
              saveData.message ||
              "Rate limit exceeded. Please try again later.",
          }));
        } else {
          throw new Error(
            saveData.error || `Failed to save screening: ${saveResponse.status}`
          );
        }
        return;
      }

      setScreeningResults((prev) => ({
        ...prev,
        [revisionNumber]: {
          evaluation: saveData.evaluation,
          nearAccount: nearAccount,
          timestamp: new Date().toISOString(),
        },
      }));
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to screen revision. Please try again.";
      setScreeningErrors((prev) => ({
        ...prev,
        [revisionNumber]: message,
      }));
      console.error("Screening error:", err);
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
            }}
          />
        </div>
      );
    }

    return (
      <div className="mt-3 space-y-2">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}
        <Button
          onClick={(e) => {
            e.stopPropagation();
            handleScreenRevision(revisionNumber);
          }}
          disabled={isScreening || !wallet || !nearAccount}
          size="sm"
          variant="outline"
          className="w-full gap-2"
        >
          {isScreening ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Screening...
            </>
          ) : wallet && nearAccount ? (
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
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
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
                            Revision {revisions.length - index} of{" "}
                            {revisions.length}
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
