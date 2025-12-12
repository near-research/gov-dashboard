"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";

import type { PendingDelta } from "./ProposalEditorContext";

interface DeltaConflictBannerProps {
  pendingDeltas: PendingDelta[];
  onApplyAll: () => void;
  onDiscardAll: () => void;
  onReviewDeltas: () => void;
}

interface DeltaConflictReviewDialogProps {
  open: boolean;
  pendingDeltas: PendingDelta[];
  onClose: () => void;
  onApplyAll: () => void;
  onDiscardAll: () => void;
}

export function DeltaConflictBanner({
  pendingDeltas,
  onApplyAll,
  onDiscardAll,
  onReviewDeltas,
}: DeltaConflictBannerProps) {
  if (pendingDeltas.length === 0) return null;

  return (
    <div
      className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-medium text-yellow-800">
            Agent suggestions conflict with your edits
          </h3>
          <p className="text-sm text-yellow-700 mt-1">
            The assistant suggested {pendingDeltas.length} change
            {pendingDeltas.length === 1 ? "" : "s"} that would overwrite your
            recent edits. Review them before applying.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              onClick={onReviewDeltas}
              className="px-3 py-1.5 text-sm bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
            >
              Review changes
            </Button>
            <Button
              onClick={onApplyAll}
              variant="outline"
              size="sm"
              className="px-3 py-1.5 text-sm border-yellow-600 text-yellow-700 rounded-md hover:bg-yellow-100"
            >
              Apply all
            </Button>
            <button
              type="button"
              onClick={onDiscardAll}
              className="px-3 py-1.5 text-sm text-yellow-600 hover:underline"
            >
              Keep my edits
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeltaConflictReviewDialog({
  open,
  pendingDeltas,
  onClose,
  onApplyAll,
  onDiscardAll,
}: DeltaConflictReviewDialogProps) {
  if (!open || pendingDeltas.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Review agent suggestions</DialogTitle>
          <p className="text-sm text-muted-foreground">
            The assistant wanted to change these fields while you were typing.
            Choose whether to keep your edits or accept all suggestions.
          </p>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pt-2">
          {pendingDeltas.map((delta) => (
            <div
              key={delta.id}
              className="rounded border border-muted-foreground/40 p-3 bg-white/80 shadow-sm"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <span>Buffered at {new Date(delta.timestamp).toLocaleTimeString()}</span>
                <span className="font-semibold">{delta.affectedPaths.length} field(s)</span>
              </div>
              {delta.preview.title && (
                <div className="text-sm">
                  <p className="font-semibold text-slate-700">Title</p>
                  <p className="text-slate-900">{delta.preview.title}</p>
                </div>
              )}
              {delta.preview.content && (
                <div className="mt-2 text-sm">
                  <p className="font-semibold text-slate-700">Content preview</p>
                  <p className="text-slate-900 whitespace-pre-wrap">
                    {delta.preview.content}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 mt-3">
          <Button variant="outline" onClick={onDiscardAll}>
            Keep my edits
          </Button>
          <Button onClick={onApplyAll}>Apply all</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
