import DOMPurify from "dompurify";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Markdown } from "@/components/proposal/Markdown";
import type { ProposalReply } from "@/components/proposal/types/proposals";
import type { ReplySummaryResponse } from "@/components/proposal/types/summaries";
import { VerificationBadge } from "@/components/VerificationBadge";

interface ReplyCardProps {
  reply: ProposalReply;
  discourseBaseUrl: string;
  summary?: ReplySummaryResponse;
  loading?: boolean;
  error?: string;
  onSummarize: () => void;
  onHideSummary: () => void;
}

export function ReplyCard({
  reply,
  discourseBaseUrl,
  summary,
  loading,
  error,
  onSummarize,
  onHideSummary,
}: ReplyCardProps) {
  const sanitizedReplyHtml = DOMPurify.sanitize(
    reply.cooked
      .replace(/href="\/u\//g, `href="${discourseBaseUrl}/u/"`)
      .replace(/href="\/t\//g, `href="${discourseBaseUrl}/t/"`)
      .replace(/href="\/c\//g, `href="${discourseBaseUrl}/c/"`)
      .replace(
        /src="\/user_avatar\//g,
        `src="${discourseBaseUrl}/user_avatar/"`
      ),
    {
      ALLOWED_TAGS: [
        "p",
        "br",
        "span",
        "div",
        "strong",
        "em",
        "u",
        "s",
        "del",
        "ins",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "a",
        "img",
        "blockquote",
        "aside",
        "pre",
        "code",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
      ],
      ALLOWED_ATTR: [
        "href",
        "src",
        "alt",
        "title",
        "class",
        "style",
        "data-username",
        "data-post-id",
        "data-user-id",
      ],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/|\/)/i,
      FORBID_TAGS: [
        "script",
        "iframe",
        "object",
        "embed",
        "form",
        "input",
        "button",
      ],
      FORBID_ATTR: [
        "onerror",
        "onload",
        "onclick",
        "onmouseover",
        "onmouseout",
        "onfocus",
        "onblur",
      ],
    }
  );

  const replyContentClass = [
    "prose prose-sm max-w-none mb-3",
    "[&_aside.quote]:border-l-4",
    "[&_aside.quote]:border-primary/30",
    "[&_aside.quote]:pl-4",
    "[&_aside.quote]:py-2",
    "[&_aside.quote]:bg-muted/30",
    "[&_aside.quote]:rounded-r",
    "[&_aside.quote]:my-3",
    "[&_aside.quote_.title]:flex",
    "[&_aside.quote_.title]:items-center",
    "[&_aside.quote_.title]:gap-2",
    "[&_aside.quote_.title]:mb-2",
    "[&_aside.quote_.title]:font-semibold",
    "[&_aside.quote_.title]:text-sm",
    "[&_aside.quote_.title]:text-foreground",
    "[&_aside.quote_img.avatar]:w-6",
    "[&_aside.quote_img.avatar]:h-6",
    "[&_aside.quote_img.avatar]:rounded-full",
    "[&_aside.quote_img.avatar]:inline-block",
    "[&_img.emoji]:inline",
    "[&_img.emoji]:align-middle",
    "[&_img.emoji]:w-5",
    "[&_img.emoji]:h-5",
    "[&_img.emoji]:mx-0",
  ].join(" ");

  return (
    <Card key={reply.id} className="bg-muted/50">
      <CardContent className="pt-6">
        <div className="flex justify-between items-start mb-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            {reply.avatar_template ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`${discourseBaseUrl}${reply.avatar_template.replace(
                  "{size}",
                  "48"
                )}`}
                alt={`${reply.username} avatar`}
                className="w-10 h-10 rounded-full"
                onError={(event) => {
                  const target = event.target as HTMLImageElement;
                  target.style.display = "none";
                  if (target.nextElementSibling) {
                    (target.nextElementSibling as HTMLElement).style.display =
                      "flex";
                  }
                }}
              />
            ) : null}
            <div
              className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary"
              style={{
                display: reply.avatar_template ? "none" : "flex",
              }}
            >
              {reply.username.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <span className="font-semibold text-foreground">
                @{reply.username}
              </span>
              <span className="ml-2">#{reply.post_number}</span>
            </div>
          </div>
          <div>
            {new Date(reply.created_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>

        <div
          className={replyContentClass}
          dangerouslySetInnerHTML={{
            __html: sanitizedReplyHtml,
          }}
        />

        {!summary ? (
          <>
            <Button
              variant="default"
              size="sm"
              onClick={onSummarize}
              disabled={loading}
            >
              {loading ? "Summarizing..." : "Summarize"}
            </Button>
            {error && (
              <Alert className="bg-red-50 border-red-200 text-red-900 mt-3">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </>
        ) : (
            <Alert className="bg-orange-50 border-orange-200 mt-3">
            <AlertDescription>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-orange-900 text-xs">
                  Summary
                </span>
                <div className="flex items-center gap-2">
                  <VerificationBadge
                    verification={
                      summary.verificationResult ?? summary.verification ?? null
                    }
                    className="text-[10px]"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={onHideSummary}
                  >
                    Hide
                  </Button>
                </div>
              </div>
              <Markdown content={summary.summary} className="text-xs" />
              <p className="text-xs text-muted-foreground mt-2">
                Summary generated. Verification details are no longer
                available.
              </p>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
