"use client";

import { useCallback } from "react";
import { useNear } from "@/hooks/useNear";
import { useGovernanceAnalytics } from "@/lib/analytics";
import type { VerificationMetadata } from "@/types/agui-events";
import {
  proposalEditorActions,
  useProposalEditorContext,
  type PendingDelta,
  type ProposalState,
} from "@/components/editor/ProposalEditorContext";
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

  const setLocalTitle = useCallback(
    (title: string) => dispatch(proposalEditorActions.setLocalTitle(title)),
    [dispatch]
  );
  const setLocalContent = useCallback(
    (content: string) => dispatch(proposalEditorActions.setLocalContent(content)),
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

  const {
    isPassing,
    isRunning,
    editorProps: flowEditorProps,
    publishBarProps,
    evaluationPanelProps,
    rateLimitInfo,
  } = useProposalFlowState({
    state,
    dispatch,
    setLocalTitle,
    setLocalContent,
    setEvaluationVerification,
    setEvaluationChatId,
    signedAccountId,
    walletSigner,
    track: trackEvent,
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

  const assistantProps = {
    publishBarProps: { ...publishBarProps, signIn },
    evaluationPanelProps,
  };

  return { editorProps, assistantProps, rateLimitInfo };
}
