// components/chat/Message.tsx
import React from "react";
import type { MessageRole } from "@/types/agui-events";
import type { DisplayRole } from "@/types/agent-ui";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

interface MessageProps {
  role: DisplayRole;
  rawRole?: MessageRole;
  label?: string;
  content: string;
  displayContent?: string;
  timestamp: Date;
  markdown: MarkdownIt;
}

const renderMarkdownContent = (
  markdown: MarkdownIt,
  content: string
): { __html: string } => ({
  __html: DOMPurify.sanitize(markdown.render(content || "")),
});

export const Message = ({
  role,
  rawRole,
  label: providedLabel,
  content,
  displayContent,
  timestamp,
  markdown,
}: MessageProps) => {
  const normalizedRole = role;
  const displayLabel = providedLabel
    ? providedLabel
    : normalizedRole === "user"
    ? "You"
    : normalizedRole === "assistant"
    ? "Agent"
    : rawRole === "developer"
    ? "Developer"
    : "System";

  const alignment =
    normalizedRole === "user" ? "justify-end" : "justify-start";

  const bubbleClasses =
    normalizedRole === "user"
      ? "bg-primary text-white rounded-2xl rounded-br-sm shadow-lg"
      : normalizedRole === "system"
      ? "bg-muted text-foreground/80 border border-dashed rounded-2xl rounded-bl-sm shadow-sm"
      : "bg-card text-card-foreground rounded-2xl rounded-bl-sm border border-border shadow-md";

  const baseProse =
    "prose prose-sm max-w-none text-sm leading-relaxed prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-headings:mt-4 prose-headings:mb-2";
  const proseClass =
    normalizedRole === "user"
      ? `${baseProse} prose-invert text-white [&_*]:text-white`
      : `${baseProse} text-foreground dark:prose-invert`;

  const labelClass =
    normalizedRole === "user"
      ? "text-white/80"
      : "text-muted-foreground text-xs";

  return (
    <div className={`flex ${alignment}`}>
      <div
        className={`max-w-[80%] min-w-[140px] sm:min-w-[200px] rounded-2xl px-4 py-2 ${
          bubbleClasses}`}
      >
        <div className="flex items-center justify-between mb-2">
          <p
            className={`text-[10px] font-semibold uppercase tracking-wide ${labelClass}`}
          >
            {displayLabel}
          </p>
          <span className="text-[10px] text-white/60">
            {timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div
          className={proseClass}
          dangerouslySetInnerHTML={renderMarkdownContent(
            markdown,
            displayContent ?? content
          )}
        />
      </div>
    </div>
  );
};
