import {
  EventType,
  type AGUIEvent,
  type CompletionMessage,
} from "@/types/agui-events";
import {
  handleWriteProposal,
  handleScreenProposal,
} from "@/server/tools/proposals";
import {
  handleSearchDiscourse,
  handleGetDiscourseTopic,
  handleGetLatestTopics,
  handleSummarizeDiscussion,
  handleSummarizeReply,
} from "@/server/tools/discourse";
import { handleGetDoc, handleSearchDocs } from "@/server/tools/docs";
import { generateId } from "./ids";
import { safeParseToolArgs as parseToolArgs } from "./tool-args";
import type { ToolCallArgs, ToolMessage } from "./types";
import type { VerificationMetadata } from "@/types/verification";

type ToolVerificationContext = {
  verificationId?: string;
  messageId?: string;
};

type ToolHandlerParams = {
  args: ToolCallArgs;
  runtimeBaseUrl: string;
  writeEvent: (event: AGUIEvent) => void;
  verificationContext?: ToolVerificationContext;
};

type ToolHandler = (params: ToolHandlerParams) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  screen_proposal: async ({ args, writeEvent, verificationContext }) => {
    if (!args.title || !args.content) {
      throw new Error("title and content are required");
    }
    const { result, verification } = await handleScreenProposal({
      title: args.title,
      content: args.content,
    });
    const fallbackVerification: VerificationMetadata | undefined = verificationContext
      ? {
          source: "near-ai-cloud",
          status: "pending",
          messageId: verificationContext.messageId,
        }
      : undefined;

    writeEvent({
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/evaluation",
          value: result,
        },
      ],
      verification: verification ?? fallbackVerification,
      timestamp: Date.now(),
    });
    return result;
  },
  write_proposal: async ({ args, writeEvent }) => {
    if (!args.title || !args.content) {
      throw new Error("title and content are required");
    }
    const { result } = await handleWriteProposal({
      title: args.title,
      content: args.content,
    });
    writeEvent({
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/title",
          value: args.title,
        },
        {
          op: "replace",
          path: "/content",
          value: args.content,
        },
      ],
      timestamp: Date.now(),
    });
    return { ...result };
  },
  search_discourse: async ({ args }) => {
    if (!args.query) throw new Error("query is required");
    const { result } = await handleSearchDiscourse({
      query: args.query,
      limit: args.limit,
    });
    return { ...result };
  },
  get_discourse_topic: async ({ args }) => {
    if (!args.topic_id) throw new Error("topic_id is required");
    const { result } = await handleGetDiscourseTopic({
      topic_id: args.topic_id,
    });
    return { ...result };
  },
  get_latest_topics: async ({ args, runtimeBaseUrl }) => {
    const { result } = await handleGetLatestTopics(
      { limit: args.limit },
      runtimeBaseUrl
    );
    return { ...result };
  },
  summarize_discussion: async ({ args, runtimeBaseUrl }) => {
    if (!args.topic_id) throw new Error("topic_id is required");
    const { result } = await handleSummarizeDiscussion(
      { topic_id: args.topic_id },
      runtimeBaseUrl
    );
    return { ...result };
  },
  summarize_reply: async ({ args, runtimeBaseUrl }) => {
    if (!args.post_id) throw new Error("post_id is required");
    const { result } = await handleSummarizeReply(
      { post_id: args.post_id },
      runtimeBaseUrl
    );
    return { ...result };
  },
  get_doc: async ({ args }) => {
    if (!args.doc_key) throw new Error("doc_key is required");
    const { result } = await handleGetDoc({ doc_key: args.doc_key });
    return { ...result };
  },
  search_docs: async ({ args }) => {
    if (!args.topic) throw new Error("topic is required");
    const { result } = await handleSearchDocs({
      topic: args.topic,
    });
    return { ...result };
  },
};

const emitToolResult = (
  writeEvent: (event: AGUIEvent) => void,
  toolCallId: string,
  result: unknown
): ToolMessage => {
  writeEvent({
    type: EventType.TOOL_CALL_RESULT,
    messageId: generateId("tool_result"),
    toolCallId,
    content: JSON.stringify(result, null, 2),
    role: "tool",
    timestamp: Date.now(),
  });

  return {
    role: "tool",
    content: JSON.stringify(result),
    tool_call_id: toolCallId,
  };
};

export async function executeToolCall({
  toolCall,
  runtimeBaseUrl,
  writeEvent,
  verificationContext,
}: {
  toolCall: NonNullable<CompletionMessage["tool_calls"]>[number];
  runtimeBaseUrl: string;
  writeEvent: (event: AGUIEvent) => void;
  verificationContext?: ToolVerificationContext;
}): Promise<ToolMessage | null> {
  const toolCallId = toolCall.id;
  const toolName = toolCall.function.name;
  const args = parseToolArgs(toolCall.function.arguments);

  if (!args.ok) {
    return emitToolResult(writeEvent, toolCallId, {
      error: `Failed to parse tool arguments: ${args.error}`,
    });
  }

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return emitToolResult(writeEvent, toolCallId, {
      error: `Unknown tool: ${toolName}`,
    });
  }

  try {
    const result = await handler({
      args: args.value,
      runtimeBaseUrl,
      writeEvent,
      verificationContext,
    });
    return emitToolResult(writeEvent, toolCallId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool call failed";
    console.error(`[Agent] Tool ${toolName} failed`, error);
    writeEvent({
      type: EventType.RUN_ERROR,
      message: `Tool ${toolName} failed: ${message}`,
      code: "TOOL_CALL_ERROR",
      timestamp: Date.now(),
    });
    return emitToolResult(writeEvent, toolCallId, { error: message });
  }
}

export async function executeToolCallsWithEvents({
  toolCalls,
  runtimeBaseUrl,
  writeEvent,
  verificationContext,
}: {
  toolCalls: NonNullable<CompletionMessage["tool_calls"]>;
  runtimeBaseUrl: string;
  writeEvent: (event: AGUIEvent) => void;
  verificationContext?: ToolVerificationContext;
}) {
  const toolMessages: ToolMessage[] = [];
  for (const toolCall of toolCalls) {
    try {
      const toolMessage = await executeToolCall({
        toolCall,
        runtimeBaseUrl,
        writeEvent,
        verificationContext,
      });
      if (toolMessage) {
        toolMessages.push(toolMessage);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected tool loop error";
      console.error("[Agent] Tool execution loop error", error);
      writeEvent({
        type: EventType.RUN_ERROR,
        message: `Tool processing halted: ${message}`,
        code: "TOOL_LOOP_ERROR",
        timestamp: Date.now(),
      });
    }
  }
  return toolMessages;
}
