import { useCallback, useRef, useState, type Dispatch, type RefObject } from "react";
import { useProposalChatAdapter } from "@/components/editor/useProposalChatAdapter";
import { type ProposalEditorAction, type ProposalState } from "@/components/editor/ProposalEditorContext";
import type { VerificationMetadata } from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";

type UseProposalChatControllerArgs = {
  proposalState: ProposalState;
  dispatch: Dispatch<ProposalEditorAction>;
  pendingTitle: string;
  pendingContent: string;
  localTitle: string;
  localContent: string;
  setLocalTitle: (title: string) => void;
  setLocalContent: (content: string) => void;
  setEvaluationVerification: (v?: VerificationMetadata) => void;
  setEvaluationChatId: (id?: string) => void;
  originalStateRef: RefObject<ProposalState | null>;
  suggestions: string[];
};

export const useProposalChatController = ({
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
  suggestions,
}: UseProposalChatControllerArgs) => {
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

  const {
    messages,
    isRunning,
    currentMessage,
    currentStep,
    activeToolCalls,
    sendMessage,
    addEvaluationMessage,
  } = useProposalChatAdapter({
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
  });

  const chatProps = {
    currentStep,
    messages,
    currentMessage,
    activeToolCalls,
    isRunning,
    suggestions,
    inputMessage,
    setInputMessage,
    sendMessage,
    messagesEndRef,
  };

  const addEvaluationToChat = useCallback(
    (evaluation: Evaluation, verification?: VerificationMetadata) =>
      addEvaluationMessage(evaluation, verification),
    [addEvaluationMessage]
  );

  return { chatProps, isRunning, messagesEndRef, addEvaluationToChat };
};
