import React, { useMemo } from "react";
import type MarkdownIt from "markdown-it";
import type { Evaluation } from "@/types/evaluation";
import { diffPartialText } from "@/utils/diff";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, AlertTriangle, X, Check } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export function ConfirmModal({
  onConfirm,
  onReject,
  evaluation,
  beforeTitle,
  beforeContent,
  afterTitle,
  afterContent,
  md,
  open,
}: {
  onConfirm: () => void;
  onReject: () => void;
  evaluation: Evaluation | null;
  beforeTitle: string;
  beforeContent: string;
  afterTitle: string;
  afterContent: string;
  md: MarkdownIt;
  open: boolean;
}) {
  const renderedAfter = useMemo(
    () => md.render(afterContent || ""),
    [md, afterContent]
  );

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onReject()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Review AI Changes</DialogTitle>
          <DialogDescription>
            Review the changes below.{" "}
            <span className="text-green-700 italic">Green italic text</span>{" "}
            shows additions,{" "}
            <span className="text-red-700 line-through">red strikethrough</span>{" "}
            shows removals.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* Evaluation */}
            {evaluation && (
              <Alert
                className={
                  evaluation.overallPass
                    ? "bg-green-50 border-green-200"
                    : "bg-yellow-50 border-yellow-200"
                }
              >
                <div className="flex items-center gap-2 mb-2">
                  {evaluation.overallPass ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  )}
                  <span
                    className={`font-semibold ${
                      evaluation.overallPass
                        ? "text-green-900"
                        : "text-yellow-900"
                    }`}
                  >
                    {evaluation.overallPass
                      ? "Passes Screening"
                      : "Still Needs Work"}
                  </span>
                </div>
                <AlertDescription
                  className={
                    evaluation.overallPass
                      ? "text-green-800"
                      : "text-yellow-800"
                  }
                >
                  {evaluation.summary}
                </AlertDescription>
              </Alert>
            )}

            {/* Title Changes */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Title Changes</h3>
              <div
                className="p-3 bg-muted rounded-lg text-sm leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: diffPartialText(beforeTitle || "", afterTitle || ""),
                }}
              />
            </div>

            <Separator />

            {/* Content Changes (Diff) */}
            <div>
              <h3 className="text-sm font-semibold mb-2">
                Content Changes (Diff)
              </h3>
              <ScrollArea className="h-[300px]">
                <div
                  className="p-3 bg-muted rounded-lg text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: diffPartialText(
                      beforeContent || "",
                      afterContent || ""
                    ),
                  }}
                />
              </ScrollArea>
            </div>

            <Separator />

            {/* Rendered Preview */}
            <div>
              <h3 className="text-sm font-semibold mb-2">
                Updated Content (Preview)
              </h3>
              <ScrollArea className="h-[400px]">
                <div className="p-5 bg-muted rounded-lg">
                  <h1 className="text-2xl font-bold mb-4">
                    {afterTitle || "Untitled"}
                  </h1>
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: renderedAfter }}
                  />
                </div>
              </ScrollArea>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button onClick={onReject} variant="outline" className="gap-2">
            <X className="h-4 w-4" />
            Reject Changes
          </Button>
          <Button onClick={onConfirm} className="gap-2">
            <Check className="h-4 w-4" />
            Accept Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
