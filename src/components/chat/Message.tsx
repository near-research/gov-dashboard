// components/chat/Message.tsx
import React from "react";
import {
  VerificationProof,
  type RemoteProof,
} from "@/components/verification/VerificationProof";
import type { VerificationMetadata, MessageRole } from "@/types/agui-events";
import type { DisplayRole, MessageProof } from "@/types/agent-ui";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

interface MessageProps {
  role: DisplayRole;
  rawRole?: MessageRole;
  label?: string;
  content: string;
  displayContent?: string;
  timestamp: Date;
  messageId?: string;
  verification?: VerificationMetadata;
  proof?: MessageProof;
  remoteProof?: RemoteProof | null;
  model?: string;
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
  messageId,
  verification,
  proof,
  remoteProof,
  model,
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

  const showProof =
    normalizedRole === "assistant" && Boolean(verification || proof || remoteProof);

  const proofTriggerLabel =
    proof?.stage === "final_synthesis"
      ? "Verify recommendation"
      : proof?.stage === "initial_reasoning"
      ? "Verify reasoning"
      : undefined;

  return (
    <div className={`flex ${alignment}`}>
      <div
        className={`max-w-[80%] min-w-[140px] sm:min-w-[200px] rounded-2xl px-4 py-2 ${
          showProof ? "pb-4" : ""
        } ${bubbleClasses}`}
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
        {showProof && (
          <VerificationProof
            verification={verification}
            verificationId={proof?.verificationId ?? messageId}
            model={model}
            requestHash={proof?.requestHash}
            responseHash={proof?.responseHash}
            nonce={proof?.nonce ?? undefined}
            expectedArch={proof?.arch ?? undefined}
            expectedDeviceCertHash={proof?.deviceCertHash ?? undefined}
            expectedRimHash={proof?.rimHash ?? undefined}
            expectedUeid={proof?.ueid ?? undefined}
            expectedMeasurements={proof?.measurements ?? undefined}
            prefetchedProof={remoteProof}
            triggerLabel={proofTriggerLabel}
            className="mt-3"
          />
        )}
      </div>
    </div>
  );
};
