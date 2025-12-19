"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EditorPane } from "@/components/editor/EditorPane";
import {
  DeltaConflictBanner,
  DeltaConflictReviewDialog,
} from "@/components/editor/DeltaConflictBanner";
import {
  ProposalEditorProvider,
  type PendingDelta,
} from "@/components/editor/ProposalEditorContext";
import { buildRemainingEvaluationsMessage } from "@/utils/rateLimitHelpers";
import { useEditorState } from "@/components/editor/hooks/useEditorState";
import { type ViewMode } from "@/components/editor/useViewModeToggle";

const AssistantSidebar = dynamic(
  () => import("./AssistantSidebar").then((mod) => mod.AssistantSidebar),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-5">
        <div
          className="card flex-1 min-h-0 animate-pulse bg-muted/30"
          aria-hidden="true"
        >
          <div className="flex-1 min-h-0" />
        </div>
      </div>
    ),
  }
);

export default function ProposalEditor() {
  return (
    <ProposalEditorProvider>
      <ProposalEditorInner />
    </ProposalEditorProvider>
  );
}

function ProposalEditorInner() {
  const { editorProps, assistantProps, rateLimitInfo } = useEditorState();
  const rateLimitMessage = buildRemainingEvaluationsMessage(
    rateLimitInfo.remainingEvaluations,
    rateLimitInfo.rateLimitResetSeconds
  );

  return (
    <div className="page-wrapper">
      {rateLimitMessage && (
        <div className="border-b border-muted-foreground/10 bg-background">
          <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
            <Alert className="border-blue-500 bg-blue-50 text-blue-900">
              <AlertDescription>{rateLimitMessage}</AlertDescription>
            </Alert>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-7xl px-4 pt-6 pb-10 sm:px-6 lg:px-8 lg:pt-8">
        <div className="grid items-start gap-8 lg:grid-cols-[2fr_1fr]">
          <EditorColumn {...editorProps} />
          <AssistantSidebar {...assistantProps} />
        </div>
      </div>
    </div>
  );
}

type EditorColumnProps = {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  localTitle: string;
  localContent: string;
  pendingTitle: string;
  pendingContent: string;
  setLocalTitle: (title: string) => void;
  setLocalContent: (content: string) => void;
  isRunning: boolean;
  pendingDeltas: PendingDelta[];
  hasConflictingDeltas: boolean;
  onApplyPendingDeltas: () => void;
  onDiscardPendingDeltas: () => void;
  showDiffHighlights: boolean;
  contentDiffHtml: string;
  hasPendingChanges: boolean;
  onAcceptChanges: () => void;
  onRejectChanges: () => void;
};

function EditorColumn({
  viewMode,
  setViewMode,
  localTitle,
  localContent,
  pendingTitle,
  pendingContent,
  setLocalTitle,
  setLocalContent,
  isRunning,
  pendingDeltas,
  hasConflictingDeltas,
  onApplyPendingDeltas,
  onDiscardPendingDeltas,
  showDiffHighlights,
  contentDiffHtml,
  hasPendingChanges,
  onAcceptChanges,
  onRejectChanges,
}: EditorColumnProps) {
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const openReview = () => setIsReviewOpen(true);
  const closeReview = () => setIsReviewOpen(false);

  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-semibold m-0">Proposal Editor</h2>
      {hasConflictingDeltas && (
        <DeltaConflictBanner
          pendingDeltas={pendingDeltas}
          onApplyAll={() => {
            onApplyPendingDeltas();
            closeReview();
          }}
          onDiscardAll={() => {
            onDiscardPendingDeltas();
            closeReview();
          }}
          onReviewDeltas={openReview}
        />
      )}
      <DeltaConflictReviewDialog
        open={isReviewOpen}
        pendingDeltas={pendingDeltas}
        onClose={closeReview}
        onApplyAll={() => {
          onApplyPendingDeltas();
          closeReview();
        }}
        onDiscardAll={() => {
          onDiscardPendingDeltas();
          closeReview();
        }}
      />
      <EditorPane
        title={localTitle}
        content={localContent}
        pendingTitle={pendingTitle}
        pendingContent={pendingContent}
        setTitle={setLocalTitle}
        setContent={setLocalContent}
        disabled={isRunning}
        viewMode={viewMode}
        onToggleView={setViewMode}
        showDiffHighlights={showDiffHighlights}
        diffHtml={contentDiffHtml}
        hasPendingChanges={hasPendingChanges}
        onAcceptChanges={onAcceptChanges}
        onRejectChanges={onRejectChanges}
      />
    </div>
  );
}
