import { Markdown } from "@/components/proposal/Markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, User, Calendar, X } from "lucide-react";
import type { ProposalRevision } from "@/types/proposals";

interface VersionSelectorProps {
  currentRevision: number;
  selectedVersion: number;
  revisions: ProposalRevision[];
  onVersionChange: (version: number) => void;
  showDiffHighlights: boolean;
  onToggleDiff: (show: boolean) => void;
  onSummarizeChanges: () => void;
  revisionSummary: string | null;
  revisionSummaryLoading: boolean;
  revisionSummaryError?: string;
  onHideSummary: () => void;
  versionDiffHtml?: string;
  embedded?: boolean;
}

export default function VersionSelector({
  currentRevision,
  selectedVersion,
  revisions,
  onVersionChange,
  showDiffHighlights,
  onToggleDiff,
  onSummarizeChanges,
  revisionSummary,
  revisionSummaryLoading,
  revisionSummaryError = "",
  onHideSummary,
  versionDiffHtml,
  embedded = false,
}: VersionSelectorProps) {
  if (currentRevision <= 1) {
    return null;
  }

  const selectedRevision = revisions.find((r) => r.version === selectedVersion);

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-4">
        {/* Version Selector */}
        <div className="flex items-center gap-2">
          <Select
            value={selectedVersion.toString()}
            onValueChange={(v) => onVersionChange(Number(v))}
            >
              <SelectTrigger className="w-[140px]" id="version-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: currentRevision }, (_, i) => i + 1)
                  .reverse()
                  .map((v) => (
                    <SelectItem key={v} value={v.toString()}>
                      v{v} {v === currentRevision && "(current)"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
        </div>

        {/* Diff Toggle */}
        {selectedVersion > 1 && (
          <div className="flex items-center gap-2">
              <Checkbox
                id="diff-toggle"
                checked={showDiffHighlights}
                onCheckedChange={onToggleDiff}
                disabled={!versionDiffHtml}
              />
              <Label htmlFor="diff-toggle" className="text-sm cursor-pointer">
                Show changes {!versionDiffHtml && "(no diff available)"}
              </Label>
            </div>
          )}

          {/* Summarize Button */}
          <Button
            onClick={() => {
              if (revisionSummary) {
                onHideSummary();
              } else {
                onSummarizeChanges();
              }
            }}
            disabled={revisionSummaryLoading}
            variant={revisionSummary ? "outline" : "default"}
            size="sm"
            className="gap-2 ml-auto"
          >
            {revisionSummaryLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Generating...
              </>
            ) : revisionSummary ? (
              <>
                <X className="h-3 w-3" />
                Hide Summary
              </>
            ) : (
              <>Summarize All Revisions</>
            )}
          </Button>
        </div>

        {/* Version Info */}
        {selectedVersion < currentRevision && selectedRevision && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />@{selectedRevision.username}
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(selectedRevision.created_at).toLocaleDateString(
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
            {selectedRevision.edit_reason && (
              <>
                <span>•</span>
                <span>{selectedRevision.edit_reason}</span>
              </>
            )}
          </div>
        )}

        {/* Revision Summary */}
        {revisionSummaryError && (
          <Alert className="bg-red-50 border-red-200 text-red-900">
            <AlertDescription>{revisionSummaryError}</AlertDescription>
          </Alert>
        )}
        {revisionSummary && (
          <>
            <Alert className="bg-purple-50 border-purple-200">
              <div className="flex items-center justify-between mb-2">
                <Badge
                  variant="outline"
                  className="gap-1 border-purple-300 text-purple-900"
                >
                  Revision History Summary
                </Badge>
                <Button
                  onClick={onHideSummary}
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                >
                  Hide
                </Button>
              </div>
              <AlertDescription>
                <Markdown content={revisionSummary} className="text-sm" />
              </AlertDescription>
            </Alert>
          </>
        )}
    </>
  );

  if (embedded) {
    return <div className="px-4 py-3 space-y-4">{body}</div>;
  }

  return (
    <Card className="bg-muted/50 mb-4">
      <CardContent className="pt-6 space-y-4">{body}</CardContent>
    </Card>
  );
}
