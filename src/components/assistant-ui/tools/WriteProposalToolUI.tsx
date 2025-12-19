"use client";

import { useEffect, useRef } from "react";
import {
  makeAssistantToolUI,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  proposalEditorActions,
  useProposalEditorContext,
} from "@/components/editor/ProposalEditorContext";

type WriteProposalToolArgs = {
  title?: string;
  content?: string;
};

function WriteProposalToolUIComponent({
  args,
  toolCallId,
  addResult,
}: ToolCallMessagePartProps<WriteProposalToolArgs>) {
  const { state, dispatch } = useProposalEditorContext();
  const toolInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!toolCallId || toolInitRef.current === toolCallId) return;
    toolInitRef.current = toolCallId;

    const baseTitle = state.localTitle;
    const baseContent = state.localContent;
    const proposedTitle =
      typeof args?.title === "string" ? args.title : baseTitle;
    const proposedContent =
      typeof args?.content === "string" ? args.content : baseContent;

    const hasChanges =
      proposedTitle !== baseTitle ||
      proposedContent !== baseContent;

    if (!hasChanges) {
      dispatch(proposalEditorActions.clearPending());
      dispatch(proposalEditorActions.clearPendingToolCall());
      return;
    }

    dispatch(proposalEditorActions.setPending(proposedTitle, proposedContent));
    dispatch(
      proposalEditorActions.setPendingToolCall({
        toolCallId,
        addResult,
      })
    );
  }, [
    addResult,
    args?.content,
    args?.title,
    dispatch,
    state.localContent,
    state.localTitle,
    toolCallId,
  ]);

  return (
    <div className="text-sm text-muted-foreground p-3">
      <div className="font-medium">✏️ Proposed changes</div>
      <p className="text-xs">
        Review the highlighted diff in the editor and use the controls above the title to accept or reject the agent&apos;s edits.
      </p>
    </div>
  );
}

export const WriteProposalToolUI = makeAssistantToolUI<WriteProposalToolArgs, unknown>(
  {
    toolName: "write_proposal",
    render: WriteProposalToolUIComponent,
  }
);
