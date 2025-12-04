"use client";

import { useRef, useCallback } from "react";
import { type MessageRole, type VerificationMetadata } from "@/types/agui-events";
import { EditorPane } from "@/components/editor/EditorPane";
import { useNear } from "@/hooks/useNear";
import { useGovernanceAnalytics } from "@/lib/analytics";
import {
  ProposalEditorProvider,
  useProposalEditorContext,
  proposalEditorActions,
  type ProposalState,
} from "@/components/editor/ProposalEditorContext";
import { AssistantSidebar } from "@/components/editor/AssistantSidebar";
import { useViewModeToggle, type ViewMode } from "@/components/editor/useViewModeToggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProposalChatController } from "@/components/editor/useProposalChatController";
import { useProposalFlowState } from "@/components/editor/useProposalFlowState";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  verification?: VerificationMetadata;
  remoteId?: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  args: string;
  status: "in_progress" | "completed";
  verification?: VerificationMetadata;
}

const suggestions = [
  "Screen this proposal against NEAR criteria",
  "Write a proposal about improving developer documentation",
  "Add a detailed budget breakdown section",
  "Generate measurable KPIs for this proposal",
  "Improve the timeline to be more realistic",
];

export default function ProposalEditor() {
  return (
    <ProposalEditorProvider>
      <ProposalEditorInner />
    </ProposalEditorProvider>
  );
}

function ProposalEditorInner() {
  const { editorProps, assistantProps } = useProposalEditorController();

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

function useProposalEditorController() {
  const { signedAccountId, wallet, signIn } = useNear();
  const trackEvent = useGovernanceAnalytics();
  const { state, dispatch } = useProposalEditorContext();
  const { viewMode, setViewMode } = useViewModeToggle();

  const originalStateRef = useRef<ProposalState | null>(null);

  const setLocalTitle = useCallback(
    (title: string) => dispatch(proposalEditorActions.setLocalTitle(title)),
    [dispatch]
  );
  const setLocalContent = useCallback(
    (content: string) => dispatch(proposalEditorActions.setLocalContent(content)),
    [dispatch]
  );
  const setShowEvalDetails = useCallback(
    (show: boolean) => dispatch(proposalEditorActions.setShowEvalDetails(show)),
    [dispatch]
  );
  const setEvaluationVerification = useCallback(
    (v?: VerificationMetadata) => dispatch(proposalEditorActions.setEvaluationVerification(v)),
    [dispatch]
  );
  const setEvaluationChatId = useCallback(
    (id?: string) => dispatch(proposalEditorActions.setEvaluationChatId(id)),
    [dispatch]
  );

  const { chatProps, isRunning } = useProposalChatController({
    proposalState: state.proposal,
    dispatch,
    pendingTitle: state.pendingTitle,
    pendingContent: state.pendingContent,
    localTitle: state.localTitle,
    localContent: state.localContent,
    setLocalTitle,
    setLocalContent,
    setEvaluationVerification,
    setEvaluationChatId,
    originalStateRef,
    suggestions,
  });

  const { isPassing, editorProps: flowEditorProps, evaluationPanelProps, publishBarProps } =
    useProposalFlowState({
      state,
      dispatch,
      setLocalTitle,
      setLocalContent,
      setShowEvalDetails,
      setEvaluationVerification,
      setEvaluationChatId,
      signedAccountId,
      wallet,
      track: trackEvent,
      isRunning,
      originalStateRef,
    });

  const editorProps: EditorColumnProps = {
    viewMode,
    setViewMode,
    isRunning,
    ...flowEditorProps,
  };

  const assistantProps = {
    isPassing,
    evaluationPanelProps,
    publishBarProps: { ...publishBarProps, signIn },
    chatProps,
  };

  return { editorProps, assistantProps };
}
type EditorColumnProps = {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  localTitle: string;
  localContent: string;
  setLocalTitle: (title: string) => void;
  setLocalContent: (content: string) => void;
  isRunning: boolean;
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
  showDiffHighlights,
  contentDiffHtml,
  hasPendingChanges,
  onAcceptChanges,
  onRejectChanges,
}: EditorColumnProps) {
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
