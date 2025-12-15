import { useCallback, useEffect, type Dispatch, type RefObject } from "react";
import { useProposalPublishing } from "@/components/editor/useProposalPublishing";
import { useDraftEvaluation } from "@/components/editor/useDraftEvaluation";
import {
  proposalEditorActions,
  type ProposalEditorAction,
  type ProposalEditorState,
  type ProposalState,
} from "@/components/editor/ProposalEditorContext";
import { type PublishStep } from "@/components/editor/PublishBar";
import type { GovernanceTrackFn } from "@/lib/analytics";
import type { VerificationMetadata } from "@/types/agui-events";
import type { WalletInterface } from "near-sign-verify";
import { client } from "@/lib/orpc";

type UseProposalFlowStateArgs = {
  state: ProposalEditorState;
  dispatch: Dispatch<ProposalEditorAction>;
  setLocalTitle: (title: string) => void;
  setLocalContent: (content: string) => void;
  setShowEvalDetails: (show: boolean) => void;
  setEvaluationVerification: (v?: VerificationMetadata) => void;
  setEvaluationChatId: (id?: string) => void;
  signedAccountId?: string | null;
  walletSigner: WalletInterface | null;
  track: GovernanceTrackFn;
  isRunning: boolean;
  originalStateRef: RefObject<ProposalState | null>;
};

export const useProposalFlowState = ({
  state,
  dispatch,
  setLocalTitle,
  setLocalContent,
  setShowEvalDetails,
  setEvaluationVerification,
  setEvaluationChatId,
  signedAccountId,
  walletSigner,
  track,
  isRunning,
  originalStateRef,
}: UseProposalFlowStateArgs) => {
  const {
    proposal: proposalState,
    localTitle,
    localContent,
    contentDiffHtml,
    hasPendingChanges,
    pendingTitle,
    pendingContent,
    showDiffHighlights,
    showEvalDetails,
    evaluationVerification,
    evaluationChatId,
  } = state;

  const isPassing = proposalState.evaluation?.overallPass === true;

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

  useEffect(() => {
    if (proposalState.evaluation) {
      setShowEvalDetails(!proposalState.evaluation.overallPass);
    }
  }, [proposalState.evaluation, setShowEvalDetails]);

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
  }, [dispatch, pendingContent, pendingTitle, proposalState]);

  const handleRejectChanges = useCallback(() => {
    if (originalStateRef.current) {
      dispatch(proposalEditorActions.setProposal(originalStateRef.current));
      dispatch(proposalEditorActions.setLocalTitle(originalStateRef.current.title));
      dispatch(proposalEditorActions.setLocalContent(originalStateRef.current.content));
    }
    dispatch(proposalEditorActions.clearPending());
  }, [dispatch, originalStateRef]);

  const publishSteps: PublishStep[] = [
    { label: "Screen (pass required)", done: isPassing },
    { label: "Connect NEAR account", done: Boolean(signedAccountId) },
    { label: "Link Discourse", done: discourseLinked },
    { label: "Publish", done: false, blocked: publishDisabled },
  ];

  const editorProps = {
    localTitle,
    localContent,
    setLocalTitle,
    setLocalContent,
    showDiffHighlights,
    contentDiffHtml,
    hasPendingChanges,
    onAcceptChanges: handleAcceptChanges,
    onRejectChanges: handleRejectChanges,
  };

  const evaluationPanelProps = {
    evaluationError,
    evalLoading,
    evaluateDraft,
    evaluation: proposalState.evaluation,
    showEvalDetails,
    onToggleEvalDetails: () => setShowEvalDetails(!showEvalDetails),
    remainingEvaluations,
    rateLimitResetSeconds,
    evaluationVerification,
    evaluationChatId,
  };

  const publishBarProps = {
    publishSteps,
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

  return {
    isPassing,
    editorProps,
    evaluationPanelProps,
    publishBarProps,
    setEvaluationVerification,
    setEvaluationChatId,
  };
};
