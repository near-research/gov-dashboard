"use client";

import { useCallback, useRef } from "react";
import { useNear } from "@/hooks/useNear";
import { useGovernanceAnalytics } from "@/lib/analytics";
import type { VerificationMetadata } from "@/types/agui-events";
import {
  proposalEditorActions,
  useProposalEditorContext,
  type PendingDelta,
  type ProposalState,
} from "@/components/editor/ProposalEditorContext";
import { useProposalChatController } from "@/components/editor/useProposalChatController";
import { useProposalFlowState } from "@/components/editor/useProposalFlowState";
import { useViewModeToggle } from "@/components/editor/useViewModeToggle";

const suggestions = [
  "Write a proposal about improving developer documentation",
  "Add a detailed budget breakdown section",
  "Generate measurable KPIs for this proposal",
  "Improve the timeline to be more realistic",
];

export function useEditorState() {
  const { signedAccountId, walletSigner, signIn } = useNear();
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
  const applyAllPendingDeltas = useCallback(
    () => dispatch(proposalEditorActions.applyAllPendingDeltas()),
    [dispatch]
  );
  const discardAllPendingDeltas = useCallback(
    () => dispatch(proposalEditorActions.discardAllPendingDeltas()),
    [dispatch]
  );

  const { chatProps, isRunning, addEvaluationToChat } = useProposalChatController({
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
      walletSigner,
      track: trackEvent,
      isRunning,
      originalStateRef,
      onEvaluationComplete: addEvaluationToChat,
    });

  const editorProps = {
    viewMode,
    setViewMode,
    isRunning,
    pendingDeltas: state.pendingDeltas,
    hasConflictingDeltas: state.hasConflictingDeltas,
    onApplyPendingDeltas: applyAllPendingDeltas,
    onDiscardPendingDeltas: discardAllPendingDeltas,
    ...flowEditorProps,
  };

  const chatPropsWithEval = {
    ...chatProps,
    onEvaluate: evaluationPanelProps.evaluateDraft,
    evalLoading: evaluationPanelProps.evalLoading,
    evaluationError: evaluationPanelProps.evaluationError,
    isPassing,
  };

  const assistantProps = {
    isPassing,
    publishBarProps: { ...publishBarProps, signIn },
    chatProps: chatPropsWithEval,
  };

  return { editorProps, assistantProps };
}
