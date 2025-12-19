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
import { z } from "zod";
import type {
  AgentConversationMessage,
  ToolCallArgs,
  ToolMessage,
} from "./types";
import { telemetry } from "@/lib/telemetry";
import { logger } from "@/lib/logger";

type ToolHandlerParams = {
  args: ToolCallArgs;
  runtimeBaseUrl: string;
  writeEvent: (event: AGUIEvent) => void;
};

type ToolHandler = (params: ToolHandlerParams) => Promise<unknown>;

const toolSchemas = {
  screen_proposal: z.object({
    title: z.string(),
    content: z.string(),
  }),
  write_proposal: z.object({
    title: z.string(),
    content: z.string(),
  }),
  search_discourse: z.object({
    query: z.string(),
    category: z.string().optional(),
    limit: z.number().optional(),
  }),
  get_discourse_topic: z.object({
    topic_id: z.string(),
  }),
  get_latest_topics: z.object({
    limit: z.number().optional(),
  }),
  summarize_discussion: z.object({
    topic_id: z.string(),
  }),
  summarize_reply: z.object({
    post_id: z.string(),
  }),
  get_doc: z.object({
    doc_key: z.string(),
  }),
  search_docs: z.object({
    topic: z.string(),
  }),
} as const;

type ToolSchemaMap = typeof toolSchemas;

type ToolName = keyof typeof toolSchemas;

type SchemaFor<T extends ToolName> = ToolSchemaMap[T];

function validateToolArgs<T extends ToolName>(
  toolName: T,
  args: unknown
): z.infer<SchemaFor<T>> {
  const schema = toolSchemas[toolName] as SchemaFor<T>;
  if (!schema) {
    throw new Error(`Unknown tool for validation: ${toolName}`);
  }

  const result = schema.safeParse(args);
  if (!result.success) {
    throw new Error(
      `Invalid arguments for tool "${toolName}": ${result.error.message}`
    );
  }

  return result.data as z.infer<SchemaFor<T>>;
}

const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  screen_proposal: async ({ args, writeEvent }) => {
    if (!args.title || !args.content) {
      throw new Error("title and content are required");
    }
    const { result, verification } = await handleScreenProposal({
      title: args.title,
      content: args.content,
    });

    writeEvent({
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/evaluation",
          value: result,
        },
      ],
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

const TOOL_CONTINUE_REGEX =
  /\b(then|after that|next|also(?: screen| evaluate)?|and also)\b/i;

type ExecuteToolCallResult = {
  toolMessage: ToolMessage | null;
  success: boolean;
};

type ExecuteToolCallsResult = {
  toolMessages: ToolMessage[];
  completionSignals: string[];
};

export async function executeToolCall({
  runId,
  toolCall,
  runtimeBaseUrl,
  writeEvent,
}: {
  runId: string;
  toolCall: NonNullable<CompletionMessage["tool_calls"]>[number];
  runtimeBaseUrl: string;
  writeEvent: (event: AGUIEvent) => void;
}): Promise<ExecuteToolCallResult> {
  const toolCallId = toolCall.id;
  const toolName = toolCall.function.name;
  const args = parseToolArgs(toolCall.function.arguments);
  const startTime = Date.now();
  let success = false;

  try {
    if (!args.ok) {
      return {
        toolMessage: emitToolResult(writeEvent, toolCallId, {
          error: `Failed to parse tool arguments: ${args.error}`,
        }),
        success: false,
      };
    }

    const handler = TOOL_HANDLERS[toolName as ToolName];
    if (!handler) {
      return {
        toolMessage: emitToolResult(writeEvent, toolCallId, {
          error: `Unknown tool: ${toolName}`,
        }),
        success: false,
      };
    }

    let validatedArgs;
    try {
      validatedArgs = validateToolArgs(toolName as ToolName, args.value);
    } catch (validationError) {
      const message =
        validationError instanceof Error
          ? validationError.message
          : "Tool arguments validation failed";
      return {
        toolMessage: emitToolResult(writeEvent, toolCallId, { error: message }),
        success: false,
      };
    }

    const result = await handler({
      args: validatedArgs,
      runtimeBaseUrl,
      writeEvent,
    });
    success = true;
    return {
      toolMessage: emitToolResult(writeEvent, toolCallId, result),
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool call failed";
    logger.error(`[Agent] Tool ${toolName} failed`, error);
    writeEvent({
      type: EventType.RUN_ERROR,
      message: `Tool ${toolName} failed: ${message}`,
      code: "TOOL_CALL_ERROR",
      timestamp: Date.now(),
    });
    return {
      toolMessage: emitToolResult(writeEvent, toolCallId, { error: message }),
      success: false,
    };
  } finally {
    telemetry.toolExecuted(runId, toolName, Date.now() - startTime, success);
  }
}

export async function executeToolCallsWithEvents({
  runId,
  toolCalls,
  runtimeBaseUrl,
  writeEvent,
  currentMessages,
  toolCallHistory,
}: {
  runId: string;
  toolCalls: NonNullable<CompletionMessage["tool_calls"]>;
  runtimeBaseUrl: string;
  writeEvent: (event: AGUIEvent) => void;
  currentMessages: AgentConversationMessage[];
  toolCallHistory: string[];
}): Promise<ExecuteToolCallsResult> {
  const toolMessages: ToolMessage[] = [];
  const completionSignals: string[] = [];
  let completionSignalSent = false;

  for (const toolCall of toolCalls) {
    try {
      const { toolMessage, success } = await executeToolCall({
        toolCall,
        runId,
        runtimeBaseUrl,
        writeEvent,
      });
      if (toolMessage) {
        toolMessages.push(toolMessage);
      }
      toolCallHistory.push(toolCall.function.name);

      if (success && !completionSignalSent) {
        const lastUserMessage = currentMessages
          .slice()
          .reverse()
          .find((msg) => msg.role === "user")
          ?.content ?? "";
        const userRequestedFollowUp = TOOL_CONTINUE_REGEX.test(
          lastUserMessage
        );

        if (!userRequestedFollowUp) {
          completionSignals.push(
            `Tool "${toolCall.function.name}" completed successfully. Respond to the user with the result. Do not call additional tools unless explicitly requested.`
          );
          completionSignalSent = true;
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected tool loop error";
      logger.error("[Agent] Tool execution loop error", error);
      writeEvent({
        type: EventType.RUN_ERROR,
        message: `Tool processing halted: ${message}`,
        code: "TOOL_LOOP_ERROR",
        timestamp: Date.now(),
      });
    }
  }

  return { toolMessages, completionSignals };
}
