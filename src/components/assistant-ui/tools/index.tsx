"use client";

import type { ComponentType } from "react";
import {
  makeAssistantToolUI,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  Loader2,
  Search,
  FileText,
  CheckCircle,
  XCircle,
  MessageSquare,
  BookOpen,
} from "lucide-react";
import { ToolHistoryCard } from "@/components/chat/ToolHistoryCard";
import ProposalCard from "@/components/proposal/ProposalCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/utils/tailwind";
import type { ToolCallUIEvent, ToolCallStatus } from "@/types/agent-ui";
import { WriteProposalToolUI } from "./WriteProposalToolUI";

const MAX_HISTORY_ITEMS = 5;

type ToolArguments = Record<string, unknown>;

function renderJson(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderToolStatusError(
  status: ToolCallMessagePartProps["status"],
  messages: { fallback: string; requiresAction?: string }
) {
  if (status.type === "requires-action") {
    return (
      <ToolError
        message={
          messages.requiresAction ??
          "Waiting for additional input before continuing"
        }
      />
    );
  }

  if (status.type === "incomplete") {
    const reason = status.reason ?? "unknown reason";
    return <ToolError message={`${messages.fallback} (${reason})`} />;
  }

  return null;
}

function ToolLoading({
  icon: Icon,
  message,
}: {
  icon: ComponentType<{ className?: string }>;
  message: string;
}) {
  return (
    <Alert
      variant="default"
      className="my-2 flex items-center gap-3 border border-border bg-muted/70 text-muted-foreground shadow-sm"
    >
      <Loader2 className="w-5 h-5 text-primary animate-spin" />
      <Icon className="w-4 h-4 text-muted-foreground" />
      <AlertDescription className="text-sm text-muted-foreground">
        {message}
      </AlertDescription>
    </Alert>
  );
}

function ToolError({ message }: { message: string }) {
  return (
    <Alert
      variant="destructive"
      className="my-2 flex items-center gap-3 border border-destructive/60 bg-destructive/10 text-destructive shadow-sm"
    >
      <XCircle className="w-5 h-5 text-destructive" />
      <AlertDescription className="text-sm text-destructive">{message}</AlertDescription>
    </Alert>
  );
}

function summaryCard(result: GetSummaryResult, args: GetSummaryArgs) {
  const proposalId = Number(args.proposalId) || 0;
  const topicSlug =
    result.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "proposal";

  return (
    <ProposalCard
      id={proposalId}
      title={result.title}
      excerpt={result.summary}
      created_at={new Date().toISOString()}
      username="Gov Assistant"
      topic_id={proposalId}
      topic_slug={topicSlug}
      reply_count={0}
      views={0}
      last_posted_at={new Date().toISOString()}
      near_wallet="delegate.near"
    />
  );
}

const mapHistoryStatus = (status: ToolCallMessagePartProps["status"]) => {
  if (status.type === "running") return "active";
  if (status.type === "requires-action") return "awaiting_response";
  return "completed";
};

const mapCallbackStatus = (
  status: ToolCallMessagePartProps["status"]
): ToolCallStatus => {
  if (status.type === "running") return "running";
  if (status.type === "requires-action") return "pending";
  return status.type === "complete" ? "completed" : "failed";
};

const toToolCallEvent = ({
  toolName,
  toolCallId,
  args,
  argsText,
  result,
  status,
}: Pick<
  ToolCallMessagePartProps,
  "toolName" | "toolCallId" | "args" | "argsText" | "result" | "status"
>): ToolCallUIEvent => {
  const timestamp = new Date();
  const toolId = toolCallId ?? `${toolName}-${timestamp.getTime()}`;
  return {
    id: `${toolId}-history`,
    kind: "tool_call",
    toolCallId: toolId,
    toolName,
    input: argsText ?? renderJson(args),
    output:
      typeof result === "string"
        ? result
        : result
        ? renderJson(result)
        : undefined,
    status: mapCallbackStatus(status),
    timestamp,
    turnNumber: 0,
  };
};

export interface GetSummaryArgs {
  proposalId: string;
}

export interface GetSummaryResult {
  title: string;
  summary: string;
  status: string;
  recommendation?: "for" | "against" | "abstain";
  proposalUrl?: string;
}

export interface ScreenProposalArgs {
  proposalId: string;
  criteria?: string[];
}

export interface ScreenProposalResult {
  passed: boolean;
  score: number;
  issues: string[];
  recommendation: string;
}

export interface SearchDiscourseArgs {
  query: string;
  category?: string;
  limit?: number;
}

export interface SearchDiscourseResult {
  topics: Array<{
    id: number;
    title: string;
    excerpt: string;
    url: string;
    createdAt: string;
  }>;
}

export interface GetDiscourseTopicArgs {
  topicId: number;
}

export interface GetDiscourseTopicResult {
  id: number;
  title: string;
  content: string;
  replies: number;
  url: string;
}

export interface GetDocArgs {
  docId: string;
}

export interface GetDocResult {
  title: string;
  content: string;
  url: string;
}

export interface SearchDocsArgs {
  query: string;
}

export interface SearchDocsResult {
  results: Array<{
    docId: string;
    title: string;
    excerpt: string;
    url: string;
  }>;
}

export const GetSummaryToolUI = makeAssistantToolUI<
  GetSummaryArgs,
  GetSummaryResult
>({
  toolName: "get_summary",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <ToolLoading
          icon={FileText}
          message={`Analyzing proposal ${args.proposalId}...`}
        />
      );
    }

    const statusError = renderToolStatusError(status, {
      fallback: "Failed to get proposal summary",
      requiresAction: "The summary tool needs more context to proceed",
    });

    if (statusError) {
      return statusError;
    }

    if (!result) {
      return null;
    }

    return <div className="my-2">{summaryCard(result, args)}</div>;
  },
});

export const ScreenProposalToolUI = makeAssistantToolUI<
  ScreenProposalArgs,
  ScreenProposalResult
>({
  toolName: "screen_proposal",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <ToolLoading
          icon={CheckCircle}
          message={`Screening proposal ${args.proposalId}...`}
        />
      );
    }

    const statusError = renderToolStatusError(status, {
      fallback: "Failed to screen proposal",
      requiresAction: "Screening needs more detail before it can finish",
    });

    if (statusError) {
      return statusError;
    }

    if (!result) {
      return null;
    }

    return (
      <Card
        className={cn(
          "my-2 border border-border shadow-sm",
          result.passed ? "bg-primary/10" : "bg-destructive/10"
        )}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {result.passed ? (
                <CheckCircle className="w-5 h-5 text-primary" />
              ) : (
                <XCircle className="w-5 h-5 text-destructive" />
              )}
              <span className="font-medium text-foreground">
                Screening {result.passed ? "Passed" : "Failed"}
              </span>
            </div>
            <span className="text-sm font-semibold text-muted-foreground">
              Score: {result.score}/100
            </span>
          </div>

          {result.issues.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                Issues Found:
              </div>
              <ul className="space-y-1">
                {result.issues.map((issue, index) => (
                  <li
                    key={`${args.proposalId}-issue-${index}`}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="mt-1">•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-sm text-muted-foreground">{result.recommendation}</p>
        </CardContent>
      </Card>
    );
  },
});

export const SearchDiscourseToolUI = makeAssistantToolUI<
  SearchDiscourseArgs,
  SearchDiscourseResult
>({
  toolName: "search_discourse",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <ToolLoading
          icon={Search}
          message={`Searching forum for "${args.query}"...`}
        />
      );
    }

    const statusError = renderToolStatusError(status, {
      fallback: "Failed to search forum",
      requiresAction: "Searching needs more input before retrying",
    });

    if (statusError) {
      return statusError;
    }

    if (!result?.topics?.length) {
      return (
        <Alert
          variant="default"
          className="my-2 border border-border bg-muted/70 text-muted-foreground shadow-sm"
        >
          <AlertDescription className="text-sm text-muted-foreground">
            No forum topics found for &ldquo;{args.query}&rdquo;
          </AlertDescription>
        </Alert>
      );
    }

    const topics = result?.topics ?? [];

    return (
      <div className="my-2 space-y-2">
        <Card className="border border-border bg-card/80">
          <CardContent className="px-4 py-2 text-sm font-medium text-muted-foreground">
            Found {topics.length} topic{topics.length !== 1 ? "s" : ""}:
          </CardContent>
        </Card>
        {topics.slice(0, MAX_HISTORY_ITEMS).map((topic) => (
          <a
            key={topic.id}
            href={topic.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block no-underline"
          >
            <Card className="border border-border bg-card text-card-foreground shadow-sm transition-colors hover:bg-muted/70">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground truncate">
                      {topic.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {topic.excerpt}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    );
  },
});

export const GetDiscourseTopicToolUI = makeAssistantToolUI<
  GetDiscourseTopicArgs,
  GetDiscourseTopicResult
>({
  toolName: "get_discourse_topic",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <ToolLoading
          icon={MessageSquare}
          message={`Loading topic #${args.topicId}...`}
        />
      );
    }

    const statusError = renderToolStatusError(status, {
      fallback: "Failed to load topic",
    });

    if (statusError) {
      return statusError;
    }

    if (!result) return null;

    return (
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block no-underline"
      >
        <Card className="my-2 border border-border bg-card text-card-foreground shadow-sm transition-colors hover:bg-muted/70">
          <CardContent className="p-4 space-y-2">
            <div className="font-medium text-foreground">{result.title}</div>
            <div className="text-sm text-muted-foreground line-clamp-3">
              {result.content}
            </div>
            <div className="text-xs text-muted-foreground">
              {result.replies} replies
            </div>
          </CardContent>
        </Card>
      </a>
    );
  },
});

export const GetDocToolUI = makeAssistantToolUI<GetDocArgs, GetDocResult>({
  toolName: "get_doc",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <ToolLoading
          icon={BookOpen}
          message={`Loading document ${args.docId}...`}
        />
      );
    }

    const statusError = renderToolStatusError(status, {
      fallback: "Failed to load document",
    });

    if (statusError) {
      return statusError;
    }

    if (!result) return null;

    return (
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block no-underline"
      >
        <Card className="my-2 border border-border bg-card text-card-foreground shadow-sm transition-colors hover:bg-muted/70">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <span className="font-medium text-foreground">
                {result.title}
              </span>
            </div>
            <div className="text-sm text-muted-foreground line-clamp-3">
              {(result?.content ?? "").slice(0, 200)}...
            </div>
          </CardContent>
        </Card>
      </a>
    );
  },
});

export const SearchDocsToolUI = makeAssistantToolUI<
  SearchDocsArgs,
  SearchDocsResult
>({
  toolName: "search_docs",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <ToolLoading
          icon={Search}
          message={`Searching documentation for "${args.query}"...`}
        />
      );
    }

    const statusError = renderToolStatusError(status, {
      fallback: "Failed to search documentation",
    });

    if (statusError) {
      return statusError;
    }

    const docs = result?.results ?? [];

    if (!docs.length) {
      return (
        <Alert
          variant="default"
          className="my-2 border border-border bg-muted/70 text-muted-foreground shadow-sm"
        >
          <AlertDescription className="text-sm text-muted-foreground">
            No documentation found for &ldquo;{args.query}&rdquo;
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="my-2 space-y-2">
        {docs.slice(0, MAX_HISTORY_ITEMS).map((doc) => (
          <a
            key={doc.docId}
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block no-underline"
          >
            <Card className="border border-border bg-card text-card-foreground shadow-sm transition-colors hover:bg-muted/70">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <BookOpen className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <div className="font-medium text-sm text-foreground">
                      {doc.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {doc.excerpt}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    );
  },
});

export const FallbackToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "*",
  render: ({ toolName, toolCallId, args, argsText, result, status }) => {
    const historyStatus = mapHistoryStatus(status);
    const event = toToolCallEvent({
      toolName,
      toolCallId,
      args,
      argsText,
      result,
      status,
    });

    return (
      <div className="my-2">
        <ToolHistoryCard status={historyStatus} tools={[event]} />
      </div>
    );
  },
});

export function GovernanceToolUIs() {
  return (
    <>
      <GetSummaryToolUI />
      <ScreenProposalToolUI />
      <SearchDiscourseToolUI />
      <GetDiscourseTopicToolUI />
      <GetDocToolUI />
      <SearchDocsToolUI />
      <WriteProposalToolUI />
      <FallbackToolUI />
    </>
  );
}
