import { PublishBar, type PublishBarProps } from "@/components/editor/PublishBar";
import { ChatPane } from "@/components/editor/ChatPane";
import type { ChatSidebarProps } from "@/components/editor/types";

type AssistantSidebarProps = {
  isPassing: boolean;
  publishBarProps: PublishBarProps;
  chatProps: ChatSidebarProps;
};

export function AssistantSidebar({
  isPassing,
  publishBarProps,
  chatProps,
}: AssistantSidebarProps) {
  return (
    <div
      style={{
        position: "sticky",
        top: "0",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        maxHeight: "calc(100vh - 150px)",
      }}
    >
      {isPassing && <PublishBar {...publishBarProps} />}
      <ChatPane {...chatProps} />
    </div>
  );
}
