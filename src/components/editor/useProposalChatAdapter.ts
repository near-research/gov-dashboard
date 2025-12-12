import { type RefObject, type SetStateAction, useCallback } from "react";
import { useProposalChat } from "@/components/editor/useProposalChat";
import {
  proposalEditorActions,
  type PendingDelta,
  type ProposalEditorAction,
  type ProposalState,
} from "@/components/editor/ProposalEditorContext";
import type { VerificationMetadata } from "@/types/agui-events";

type AdapterArgs = {
  proposalState: ProposalState;
  dispatch: (action: ProposalEditorAction) => void;
  pendingTitle: string;
  pendingContent: string;
  localTitle: string;
  localContent: string;
  setLocalTitle: (title: string) => void;
  setLocalContent: (content: string) => void;
  setEvaluationVerification: (v?: VerificationMetadata) => void;
  setEvaluationChatId: (id?: string) => void;
  originalStateRef: RefObject<ProposalState | null>;
  setInputMessage: (value: SetStateAction<string>) => void;
};

export function useProposalChatAdapter({
  proposalState,
  dispatch,
  pendingTitle,
  pendingContent,
  localTitle,
  localContent,
  setLocalTitle,
  setLocalContent,
  setEvaluationVerification,
  setEvaluationChatId,
  originalStateRef,
  setInputMessage,
}: AdapterArgs) {
  const setPendingBoth = useCallback(
    (title: string, content: string) =>
      dispatch(proposalEditorActions.setPending(title, content)),
    [dispatch]
  );
  const addPendingDelta = useCallback(
    (delta: PendingDelta) =>
      dispatch(proposalEditorActions.addPendingDelta(delta)),
    [dispatch]
  );

  return useProposalChat({
    proposalState,
    setProposalState: (updater: SetStateAction<ProposalState>) =>
      dispatch(
        typeof updater === "function"
          ? proposalEditorActions.updateProposal(
              updater as (prev: ProposalState) => ProposalState
            )
          : proposalEditorActions.setProposal(updater)
      ),
    setEvaluationVerification,
    setEvaluationChatId,
    localTitle,
    localContent,
    setLocalTitle,
    setLocalContent,
    setPending: setPendingBoth,
    setContentDiffHtml: (html: string) =>
      dispatch(proposalEditorActions.setDiffHtml(html)),
    setHasPendingChanges: (value: boolean) =>
      value
        ? dispatch(proposalEditorActions.setPending(pendingTitle, pendingContent))
        : dispatch(proposalEditorActions.clearPending()),
    setShowDiffHighlights: (value: boolean) =>
      dispatch(proposalEditorActions.setShowDiff(value)),
    originalStateRef,
    setInputMessage,
    addPendingDelta,
  });
}
