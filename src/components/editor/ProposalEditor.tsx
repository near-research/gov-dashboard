"use client";

import { useState } from "react";
import { EditorPane } from "@/components/editor/EditorPane";
import { AssistantSidebar } from "@/components/editor/AssistantSidebar";
import { DeltaConflictBanner, DeltaConflictReviewDialog } from "@/components/editor/DeltaConflictBanner";
import { ProposalEditorProvider, type PendingDelta } from "@/components/editor/ProposalEditorContext";
import { useEditorState } from "@/components/editor/hooks/useEditorState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type ViewMode } from "@/components/editor/useViewModeToggle";

export default function ProposalEditor() {
  return (
    <ProposalEditorProvider>
      <ProposalEditorInner />
    </ProposalEditorProvider>
  );
}

function ProposalEditorInner() {
  const { editorProps, assistantProps } = useEditorState();

  return (
    <div className="page-wrapper">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
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
    <div className="flex flex-col gap-5">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="page-title m-0 text-xl">Proposal Editor</h1>
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList className="bg-transparent p-0">
            <TabsTrigger
              value="editor"
              className="px-3 py-1 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Editor
            </TabsTrigger>
            <TabsTrigger
              value="preview"
              className="px-3 py-1 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Preview
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
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
      <div className="card">
        <EditorPane
          title={localTitle}
          content={localContent}
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
    </div>
  );
}
