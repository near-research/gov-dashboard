import { createContext, useContext, useReducer, type ReactNode } from "react";
import { applyPatch, type Operation } from "fast-json-patch";
import type { VerificationMetadata } from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";
import { logger } from "@/lib/logger";

export type ProposalState = {
  title: string;
  content: string;
  evaluation: Evaluation | null;
};

export type PendingDelta = {
  id: string;
  delta: Operation[];
  timestamp: number;
  affectedPaths: string[];
  preview: {
    title?: string;
    content?: string;
    evaluation?: Evaluation | null;
  };
};

export type ProposalEditorState = {
  proposal: ProposalState;
  localTitle: string;
  localContent: string;
  snapshotTitle: string;
  snapshotContent: string;
  contentDiffHtml: string;
  hasPendingChanges: boolean;
  pendingTitle: string;
  pendingContent: string;
  showDiffHighlights: boolean;
  showEvalDetails: boolean;
  evaluationVerification?: VerificationMetadata;
  evaluationChatId?: string;
  pendingDeltas: PendingDelta[];
  hasConflictingDeltas: boolean;
};

export type ProposalEditorAction =
  | { type: "SET_PROPOSAL"; payload: ProposalState }
  | { type: "UPDATE_PROPOSAL"; payload: (prev: ProposalState) => ProposalState }
  | { type: "SET_LOCAL_TITLE"; payload: string }
  | { type: "SET_LOCAL_CONTENT"; payload: string }
  | { type: "SET_SNAPSHOT"; payload: { title: string; content: string } }
  | { type: "SET_DIFF_HTML"; payload: string }
  | { type: "SET_PENDING"; payload: { title: string; content: string } }
  | { type: "CLEAR_PENDING" }
  | { type: "SET_SHOW_DIFF"; payload: boolean }
  | { type: "SET_SHOW_EVAL_DETAILS"; payload: boolean }
  | { type: "SET_EVALUATION_VERIFICATION"; payload?: VerificationMetadata }
  | { type: "SET_EVALUATION_CHAT_ID"; payload?: string }
  | { type: "ADD_PENDING_DELTA"; payload: PendingDelta }
  | { type: "APPLY_PENDING_DELTA"; payload: string }
  | { type: "DISCARD_PENDING_DELTA"; payload: string }
  | { type: "APPLY_ALL_PENDING_DELTAS" }
  | { type: "DISCARD_ALL_PENDING_DELTAS" };

const initialProposal: ProposalState = { title: "", content: "", evaluation: null };
type Action = ProposalEditorAction;

const initialState: ProposalEditorState = {
  proposal: initialProposal,
  localTitle: "",
  localContent: "",
  snapshotTitle: "",
  snapshotContent: "",
  contentDiffHtml: "",
  hasPendingChanges: false,
  pendingTitle: "",
  pendingContent: "",
  showDiffHighlights: false,
  showEvalDetails: false,
  evaluationVerification: undefined,
  evaluationChatId: undefined,
  pendingDeltas: [],
  hasConflictingDeltas: false,
};

function reducer(state: ProposalEditorState, action: ProposalEditorAction): ProposalEditorState {
  switch (action.type) {
    case "SET_PROPOSAL":
      return { ...state, proposal: action.payload };
    case "UPDATE_PROPOSAL": {
      const updatedProposal = action.payload(state.proposal);
      console.log("[EVAL-DEBUG-4] Reducer UPDATE_PROPOSAL", {
        hasEvaluation: Boolean(updatedProposal.evaluation),
        overallPass: updatedProposal.evaluation?.overallPass,
        ts: Date.now(),
      });
      return { ...state, proposal: updatedProposal };
    }
    case "SET_LOCAL_TITLE":
      return { ...state, localTitle: action.payload };
    case "SET_LOCAL_CONTENT":
      return { ...state, localContent: action.payload };
    case "SET_SNAPSHOT":
      return {
        ...state,
        snapshotTitle: action.payload.title,
        snapshotContent: action.payload.content,
      };
    case "SET_DIFF_HTML":
      return { ...state, contentDiffHtml: action.payload };
    case "SET_PENDING":
      return {
        ...state,
        pendingTitle: action.payload.title,
        pendingContent: action.payload.content,
        hasPendingChanges: true,
        showDiffHighlights: true,
      };
    case "CLEAR_PENDING":
      return {
        ...state,
        pendingTitle: "",
        pendingContent: "",
        hasPendingChanges: false,
        showDiffHighlights: false,
        contentDiffHtml: "",
      };
    case "SET_SHOW_DIFF":
      return { ...state, showDiffHighlights: action.payload };
    case "SET_SHOW_EVAL_DETAILS":
      return { ...state, showEvalDetails: action.payload };
    case "SET_EVALUATION_VERIFICATION":
      return { ...state, evaluationVerification: action.payload };
    case "SET_EVALUATION_CHAT_ID":
      return { ...state, evaluationChatId: action.payload };
    case "ADD_PENDING_DELTA":
      return {
        ...state,
        pendingDeltas: [...state.pendingDeltas, action.payload],
        hasConflictingDeltas: true,
      };
    case "APPLY_PENDING_DELTA": {
      const targetDelta = state.pendingDeltas.find((delta) => delta.id === action.payload);
      if (!targetDelta) return state;
      let updatedProposal = state.proposal;
      try {
        const result = applyPatch(updatedProposal, targetDelta.delta, true, false);
        updatedProposal = result.newDocument as ProposalState;
      } catch (error) {
        logger.error("[Editor] Failed to apply pending delta", error);
      }
      const remaining = state.pendingDeltas.filter((delta) => delta.id !== action.payload);
      return {
        ...state,
        proposal: updatedProposal,
        localTitle: updatedProposal.title,
        localContent: updatedProposal.content,
        pendingDeltas: remaining,
        hasConflictingDeltas: remaining.length > 0,
      };
    }
    case "DISCARD_PENDING_DELTA": {
      const remaining = state.pendingDeltas.filter((delta) => delta.id !== action.payload);
      return {
        ...state,
        pendingDeltas: remaining,
        hasConflictingDeltas: remaining.length > 0,
      };
    }
    case "APPLY_ALL_PENDING_DELTAS": {
      let updatedProposal = state.proposal;
      try {
        state.pendingDeltas.forEach((delta) => {
          const result = applyPatch(updatedProposal, delta.delta, true, false);
          updatedProposal = result.newDocument as ProposalState;
        });
      } catch (error) {
        logger.error("[Editor] Failed to apply pending deltas", error);
      }
      return {
        ...state,
        proposal: updatedProposal,
        localTitle: updatedProposal.title,
        localContent: updatedProposal.content,
        pendingDeltas: [],
        hasConflictingDeltas: false,
      };
    }
    case "DISCARD_ALL_PENDING_DELTAS":
      return {
        ...state,
        pendingDeltas: [],
        hasConflictingDeltas: false,
      };
    default:
      return state;
  }
}

const ProposalEditorContext = createContext<
  | {
      state: ProposalEditorState;
      dispatch: React.Dispatch<ProposalEditorAction>;
    }
  | undefined
>(undefined);

export function ProposalEditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <ProposalEditorContext.Provider value={{ state, dispatch }}>
      {children}
    </ProposalEditorContext.Provider>
  );
}

export function useProposalEditorContext() {
  const ctx = useContext(ProposalEditorContext);
  if (!ctx) {
    throw new Error("useProposalEditorContext must be used within a ProposalEditorProvider");
  }
  return ctx;
}

export const proposalEditorActions = {
  setProposal: (proposal: ProposalState): ProposalEditorAction => ({
    type: "SET_PROPOSAL",
    payload: proposal,
  }),
  updateProposal: (updater: (prev: ProposalState) => ProposalState): ProposalEditorAction => ({
    type: "UPDATE_PROPOSAL",
    payload: updater,
  }),
  setLocalTitle: (title: string): Action => ({ type: "SET_LOCAL_TITLE", payload: title }),
  setLocalContent: (content: string): Action => ({ type: "SET_LOCAL_CONTENT", payload: content }),
  setSnapshot: (title: string, content: string): Action => ({
    type: "SET_SNAPSHOT",
    payload: { title, content },
  }),
  setDiffHtml: (html: string): Action => ({ type: "SET_DIFF_HTML", payload: html }),
  setPending: (title: string, content: string): Action => ({
    type: "SET_PENDING",
    payload: { title, content },
  }),
  clearPending: (): Action => ({ type: "CLEAR_PENDING" }),
  setShowDiff: (show: boolean): Action => ({ type: "SET_SHOW_DIFF", payload: show }),
  setShowEvalDetails: (show: boolean): Action => ({ type: "SET_SHOW_EVAL_DETAILS", payload: show }),
  setEvaluationVerification: (v?: VerificationMetadata): Action => ({
    type: "SET_EVALUATION_VERIFICATION",
    payload: v,
  }),
  setEvaluationChatId: (id?: string): Action => ({
    type: "SET_EVALUATION_CHAT_ID",
    payload: id,
  }),
  addPendingDelta: (delta: PendingDelta): Action => ({
    type: "ADD_PENDING_DELTA",
    payload: delta,
  }),
  applyPendingDelta: (id: string): Action => ({
    type: "APPLY_PENDING_DELTA",
    payload: id,
  }),
  discardPendingDelta: (id: string): Action => ({
    type: "DISCARD_PENDING_DELTA",
    payload: id,
  }),
  applyAllPendingDeltas: (): Action => ({ type: "APPLY_ALL_PENDING_DELTAS" }),
  discardAllPendingDeltas: (): Action => ({ type: "DISCARD_ALL_PENDING_DELTAS" }),
};
