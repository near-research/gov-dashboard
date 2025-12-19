import { useCallback, useEffect, type Dispatch } from "react";
import { useProposalPublishing } from "@/components/editor/useProposalPublishing";
import { useDraftEvaluation } from "@/components/editor/useDraftEvaluation";
import {
  proposalEditorActions,
  type ProposalEditorAction,
  type ProposalEditorState,
  type ProposalState,
} from "@/components/editor/ProposalEditorContext";
import type { GovernanceTrackFn } from "@/lib/analytics";
import type { VerificationMetadata } from "@/types/agui-events";
import type { WalletInterface } from "near-sign-verify";
import { client } from "@/lib/orpc";

type UseProposalFlowStateArgs = {
  state: ProposalEditorState;
  dispatch: Dispatch<ProposalEditorAction>;
  setLocalTitle: (title: string) => void;
  setLocalContent: (content: string) => void;
  setEvaluationVerification: (v?: VerificationMetadata) => void;
  setEvaluationChatId: (id?: string) => void;
  signedAccountId?: string | null;
  walletSigner: WalletInterface | null;
  track: GovernanceTrackFn;
};

export const useProposalFlowState = ({
  state,
  dispatch,
  setLocalTitle,
  setLocalContent,
  setEvaluationVerification,
  setEvaluationChatId,
  signedAccountId,
  walletSigner,
  track,
}: UseProposalFlowStateArgs) => {
  const {
    proposal: proposalState,
    localTitle,
    localContent,
    contentDiffHtml,
    hasPendingChanges,
    pendingTitle,
    pendingContent,
    pendingToolCall,
    showDiffHighlights,
    evaluationVerification,
  } = state;

  const evaluation = proposalState.evaluation;
  const isPassing = evaluation?.overallPass === true;

  const {
    publishLoading,
    publishError,
    publishSuccess,
    discourseLinked,
    linkPayload,
    linking,
    linkError,
    publishDisabled,
    setLinkPayload,
    startDiscourseLink,
    completeDiscourseLink,
    publishToDiscourse,
    clearPublishError,
    clearLinkError,
  } = useProposalPublishing({
    client,
    walletSigner,
    signedAccountId,
    isPassing,
    title: localTitle,
    content: localContent,
    track,
  });

  const {
    remainingEvaluations,
    rateLimitResetSeconds,
    evaluationError,
    evalLoading,
    evaluateDraft,
  } = useDraftEvaluation({
    localTitle,
    localContent,
    dispatch,
    track,
    setEvaluationVerification,
    setEvaluationChatId,
  });

  const isRunning = evalLoading;
  const handleEvaluateDraft = useCallback(() => {
    console.log("[Screen] Button clicked");
    void evaluateDraft();
  }, [evaluateDraft]);
  const evaluationPanelProps = {
    evaluation,
    evaluationError,
    evaluationVerification,
    signedAccountId,
  };

  useEffect(() => {
    if (!isRunning) {
      setLocalTitle(proposalState.title);
      setLocalContent(proposalState.content);
    }
  }, [proposalState.title, proposalState.content, isRunning, setLocalContent, setLocalTitle]);

  useEffect(() => {
    if (isRunning) {
      dispatch(proposalEditorActions.setSnapshot(localTitle, localContent));
    }
  }, [dispatch, isRunning, localContent, localTitle]);

  const handleAcceptChanges = useCallback(() => {
    dispatch(
      proposalEditorActions.setProposal({
        ...proposalState,
        title: pendingTitle,
        content: pendingContent,
        evaluation: null,
      })
    );
    dispatch(proposalEditorActions.setLocalTitle(pendingTitle));
    dispatch(proposalEditorActions.setLocalContent(pendingContent));
    dispatch(proposalEditorActions.setEvaluationVerification(undefined));
    dispatch(proposalEditorActions.setEvaluationChatId(undefined));
    dispatch(proposalEditorActions.clearPending());
    if (pendingToolCall?.addResult) {
      try {
        pendingToolCall.addResult({
          accepted: true,
          title: pendingTitle,
          content: pendingContent,
        });
      } catch (error) {
        console.warn("[Accept] addResult failed (non-critical):", error);
      }
    }
    dispatch(proposalEditorActions.clearPendingToolCall());
  }, [dispatch, pendingContent, pendingTitle, proposalState, pendingToolCall]);

  const handleRejectChanges = useCallback(() => {
    if (pendingToolCall?.addResult) {
      try {
        pendingToolCall.addResult({
          accepted: false,
          title: localTitle,
          content: localContent,
        });
      } catch (error) {
        console.warn("[Reject] addResult failed (non-critical):", error);
      }
    }
    dispatch(proposalEditorActions.clearPending());
    dispatch(proposalEditorActions.clearPendingToolCall());
  }, [dispatch, localContent, localTitle, pendingToolCall]);

  const editorProps = {
    localTitle,
    localContent,
    setLocalTitle,
    setLocalContent,
    pendingTitle,
    pendingContent,
    showDiffHighlights,
    contentDiffHtml,
    hasPendingChanges,
    onAcceptChanges: handleAcceptChanges,
    onRejectChanges: handleRejectChanges,
  };

  const publishBarProps = {
    isPassing,
    evaluateDraft: handleEvaluateDraft,
    evalLoading,
    publishDisabled,
    publishLoading,
    publishError,
    publishSuccess,
    discourseLinked,
    signedAccountId,
    linkPayload,
    linkError,
    linking,
    startDiscourseLink,
    completeDiscourseLink,
    setLinkPayload,
    clearPublishError,
    clearLinkError,
    publishToDiscourse,
  };
  const rateLimitInfo = {
    remainingEvaluations,
    rateLimitResetSeconds,
  };

  return {
    isPassing,
    isRunning,
    editorProps,
    publishBarProps,
    evaluationPanelProps,
    setEvaluationVerification,
    setEvaluationChatId,
    rateLimitInfo,
  };
};
