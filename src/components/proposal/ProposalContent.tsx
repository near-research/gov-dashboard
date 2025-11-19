import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { Markdown } from "@/components/proposal/Markdown";
import VersionSelector from "@/components/proposal/revisions/VersionSelector";
import { VerificationProof } from "@/components/verification/VerificationProof";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronUp, FileText, History } from "lucide-react";
import type { ProposalFrontmatter } from "@/utils/metadata";
import type { ProposalRevision } from "@/types/proposals";
import type {
  ProposalRevisionSummaryResponse,
  TextSummaryResponse,
} from "@/types/summaries";

const FRONTMATTER_FIELDS: Array<{
  label: string;
  key: keyof ProposalFrontmatter;
}> = [
  { label: "hsp", key: "hsp" },
  { label: "title", key: "title" },
  { label: "description", key: "description" },
  { label: "author", key: "author" },
  { label: "status", key: "status" },
  { label: "type", key: "type" },
  { label: "category", key: "category" },
  { label: "created", key: "created" },
  { label: "requires", key: "requires" },
];

interface ProposalContentProps {
  content: string;
  metadata: ProposalFrontmatter;
  isExpanded: boolean;
  onToggleExpand: (expanded: boolean) => void;
  proposalSummary: TextSummaryResponse | null;
  proposalSummaryLoading: boolean;
  proposalSummaryError?: string;
  onFetchProposalSummary: () => void;
  onHideProposalSummary: () => void;
  showRevisions: boolean;
  onToggleRevisions: () => void;
  hasRevisions: boolean;
  currentRevision: number;
  revisionCount: number;
  showDiffHighlights: boolean;
  versionDiffHtml: string;
  revisions?: ProposalRevision[];
  selectedVersion?: number;
  onVersionChange?: (version: number) => void;
  onToggleDiff?: (show: boolean) => void;
  onSummarizeChanges?: () => void;
  revisionSummary?: ProposalRevisionSummaryResponse | null;
  revisionSummaryLoading?: boolean;
  revisionSummaryError?: string;
  onHideRevisionSummary?: () => void;
}

export default function ProposalContent({
  content,
  metadata,
  isExpanded,
  onToggleExpand,
  proposalSummary,
  proposalSummaryLoading,
  proposalSummaryError,
  onFetchProposalSummary,
  onHideProposalSummary,
  showRevisions,
  onToggleRevisions,
  hasRevisions,
  currentRevision,
  revisionCount,
  showDiffHighlights,
  versionDiffHtml,
  revisions = [],
  selectedVersion,
  onVersionChange,
  onToggleDiff,
  onSummarizeChanges,
  revisionSummary,
  revisionSummaryLoading,
  revisionSummaryError,
  onHideRevisionSummary,
}: ProposalContentProps) {
  const renderedContent = useMemo(() => {
    if (showDiffHighlights && versionDiffHtml) {
      return DOMPurify.sanitize(versionDiffHtml);
    }

    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
    });

    const rendered = md.render(content);
    return DOMPurify.sanitize(rendered);
  }, [content, showDiffHighlights, versionDiffHtml]);

  // Check if any metadata fields have actual values
  const hasMetadata = useMemo(() => {
    return FRONTMATTER_FIELDS.some(({ key }) => {
      const value = metadata[key];
      return value !== undefined && value !== null && value !== "";
    });
  }, [metadata]);

  return (
    <>
      {/* Global diff styles - always present */}
      <style>{`
        ins {
          background-color: #dcfce7 !important;
          color: inherit !important;
          text-decoration: none !important;
          font-style: normal !important;
        }
        del {
          background-color: #fee2e2 !important;
          color: inherit !important;
          text-decoration: line-through !important;
        }
      `}</style>
      <div className="sticky top-16 z-30">
        <div className="bg-card rounded-t-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
          <CardHeader className="pb-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 min-h-[40px]">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Content
                </CardTitle>
                <Button
                  onClick={() => {
                    if (proposalSummary) {
                      onHideProposalSummary();
                    } else {
                      onFetchProposalSummary();
                    }
                  }}
                  disabled={proposalSummaryLoading}
                  variant={proposalSummary ? "outline" : "default"}
                  size="sm"
                  className="gap-2"
                >
                  {proposalSummaryLoading
                    ? "Generating..."
                    : proposalSummary
                    ? "Hide Summary"
                    : "Summarize"}
                </Button>
              </div>

              <div className="flex items-center gap-2 min-h-[40px]">
                {hasRevisions && (
                  <Button
                    onClick={onToggleRevisions}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    <History className="h-4 w-4" />
                    {showRevisions ? "Hide" : "Show"} Revisions (
                    {currentRevision - 1})
                  </Button>
                )}
                <Button
                  onClick={() => onToggleExpand(!isExpanded)}
                  variant="secondary"
                  size="sm"
                  className="gap-2"
                >
                  {isExpanded ? (
                    <>
                      Hide Content
                      <ChevronUp className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Show Content
                      <ChevronDown className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
            {proposalSummaryError && (
              <Alert className="mt-4 border-red-300 bg-red-50 text-red-900">
                <AlertDescription>{proposalSummaryError}</AlertDescription>
              </Alert>
            )}
          </CardHeader>
        </div>
      </div>

      {showRevisions && hasRevisions && revisions.length > 0 && (
        <div className="px-6 py-4 border-b bg-muted/30">
          <VersionSelector
            embedded
            currentRevision={currentRevision}
            selectedVersion={selectedVersion ?? currentRevision}
            revisions={revisions}
            onVersionChange={onVersionChange ?? (() => {})}
            showDiffHighlights={showDiffHighlights}
            onToggleDiff={(show) => onToggleDiff?.(show)}
            onSummarizeChanges={() => onSummarizeChanges?.()}
            revisionSummary={revisionSummary ?? null}
            revisionSummaryLoading={!!revisionSummaryLoading}
            revisionSummaryError={revisionSummaryError ?? ""}
            onHideSummary={() => onHideRevisionSummary?.()}
            versionDiffHtml={versionDiffHtml}
          />
        </div>
      )}

      <CardContent className="space-y-4 pt-8 rounded-b-2xl">
        {/* AI Summary */}
        {proposalSummary && (
          <>
            <Alert className="bg-blue-50 border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">AI Summary</Badge>
              </div>
              <AlertDescription className="space-y-3">
                <Markdown
                  content={proposalSummary.summary}
                  className="text-sm"
                />
                <VerificationProof
                  verification={proposalSummary.verification ?? undefined}
                  verificationId={proposalSummary.verificationId ?? undefined}
                  model={proposalSummary.model ?? undefined}
                />
              </AlertDescription>
            </Alert>
            <Separator />
          </>
        )}

        {/* Metadata */}
        {hasMetadata && (
          <>
            <div className="rounded-xl border border-border/70 p-4 bg-muted/30 shadow-sm">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {FRONTMATTER_FIELDS.map(({ label, key }) => {
                  const value = metadata[key];
                  if (!value) return null;
                  return (
                    <div key={label} className="flex items-start gap-2">
                      <dt className="font-medium text-muted-foreground min-w-[90px]">
                        {label}:
                      </dt>
                      <dd className="text-foreground">{value}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
            <Separator />
          </>
        )}

        {/* Content */}
        {isExpanded ? (
          <div className="w-full overflow-x-auto">
            <div
              className="prose prose-sm max-w-full break-words [&_*]:break-words [&>ul]:list-disc [&>ol]:list-decimal [&>ul]:ml-4 [&>ol]:ml-4 [&_table]:w-full [&_table]:max-w-full"
              dangerouslySetInnerHTML={{ __html: renderedContent }}
            />
          </div>
        ) : (
          <div className="flex justify-center pt-2">
            <Button
              onClick={() => onToggleExpand(true)}
              variant="secondary"
              className="gap-2"
            >
              Read More
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </>
  );
}
