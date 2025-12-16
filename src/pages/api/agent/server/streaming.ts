import {
  EventType,
  type AGUIEvent,
  type VerificationMetadata,
} from "@/types/agui-events";
import type { StreamResult } from "./types";
import { generateId } from "./ids";
import { AI_COMPLETION_TIMEOUT_MS } from "@/constants/agent";
import { logger } from "@/lib/logger";
import type { NearAIClient } from "@/lib/near-ai/client";
import { verifyChatMessage } from "@/lib/near-ai/verification/verify";

type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
};

type StreamingContent =
  | string
  | Array<{ text?: string }>
  | { text?: string };

type StreamChoiceDelta = {
  content?: StreamingContent;
  tool_calls?: ToolCallDelta[];
};

type StreamChoice = {
  delta?: StreamChoiceDelta;
  finish_reason?: string | null;
};

type StreamChunk = {
  choices?: StreamChoice[];
};

const isTextObject = (
  value: unknown
): value is { text?: string } =>
  typeof value === "object" && value !== null && "text" in value;

export async function getStreamingResponse(
  client: NearAIClient,
  {
    requestBodyString,
  }: {
    requestBodyString: string;
  }
): Promise<Response> {
  try {
    const response = await client.chatCompletionsStream(requestBodyString, {
      timeout: AI_COMPLETION_TIMEOUT_MS,
    });
    if (!response.body) {
      throw new Error("NEAR AI response missing body");
    }
    return response;
  } catch (error) {
    logger.error("[Agent] NEAR AI API error:", error);
    const statusCode =
      error instanceof Error && "statusCode" in error
        ? (error as { statusCode?: number }).statusCode || 500
        : 500;
    const details = error instanceof Error ? error.message : "Unknown error";
    const err: Error & { statusCode?: number } = new Error(
      `NEAR AI API error: ${statusCode} - ${details}`
    );
    err.statusCode = statusCode;
    throw err;
  }
}

export async function consumeStream({
  response,
  writeEvent,
  captureToolCalls = false,
  requestBodyString,
  model,
}: {
  response: Response;
  writeEvent: (event: AGUIEvent) => void;
  captureToolCalls?: boolean;
  requestBodyString?: string;
  model?: string;
}): Promise<StreamResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming body missing");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let rawSseText = "";
  let done = false;
  const assistantMessageId = generateId("msg");
  let assistantMessageStarted = false;
  let assistantContent = "";
  let finishReason: string | null = null;
  let streamParseErrorReported = false;
  let toolDeltaErrorReported = false;
  let shouldAbortStream = false;

  const dedupeChunk = (existing: string, delta: string) => {
    if (!delta) return "";
    if (!existing) return delta;
    let overlap = Math.min(existing.length, delta.length);
    while (overlap > 0) {
      if (
        existing.slice(existing.length - overlap) === delta.slice(0, overlap)
      ) {
        return delta.slice(overlap);
      }
      overlap -= 1;
    }
    return delta;
  };

  const normalizeToolDelta = (value: unknown) => {
    if (typeof value === "string") {
      return value;
    }
    if (value === undefined || value === null) {
      return "";
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const reportStreamParseError = (details: string) => {
    if (streamParseErrorReported) return;
    streamParseErrorReported = true;
    logger.warn("[Agent] Streaming parse error", { details });
    // Terminal events are now deduplicated upstream, so duplicate RUN_ERROR
    // notifications will be suppressed automatically.
    writeEvent({
      type: EventType.RUN_ERROR,
      message: "Upstream stream produced malformed data",
      code: "STREAM_PARSE_ERROR",
      timestamp: Date.now(),
    });
  };

  const reportToolDeltaError = (details: string) => {
    if (toolDeltaErrorReported) return;
    toolDeltaErrorReported = true;
    shouldAbortStream = true;
    logger.warn("[Agent] Tool delta processing error", { details });
    // The safe writer enforces a single RUN_ERROR, so repeated calls here are
    // harmless once the terminal event has already been emitted.
    writeEvent({
      type: EventType.RUN_ERROR,
      message: "Tool updates could not be parsed cleanly",
      code: "TOOL_DELTA_PARSE_ERROR",
      timestamp: Date.now(),
    });
  };

  type ToolCallState = {
    id: string;
    name: string;
    args: string;
    started: boolean;
  };

  const toolCallStates = new Map<number, ToolCallState>();
  const toolCallIndexes: number[] = [];
  let toolStepStarted = false;

  const ensureTextMessageStarted = () => {
    if (!assistantMessageStarted) {
      assistantMessageStarted = true;
      writeEvent({
        type: EventType.TEXT_MESSAGE_START,
        messageId: assistantMessageId,
        role: "assistant",
        timestamp: Date.now(),
      });
    }
  };

  const ensureToolCallState = (index: number): ToolCallState => {
    if (!toolCallStates.has(index)) {
      const newState: ToolCallState = {
        id: generateId("tool_call"),
        name: "",
        args: "",
        started: false,
      };
      toolCallStates.set(index, newState);
      toolCallIndexes.push(index);
    }
    return toolCallStates.get(index)!;
  };

  const ensureToolStepStarted = () => {
    if (!toolStepStarted) {
      toolStepStarted = true;
      writeEvent({
        type: EventType.STEP_STARTED,
        stepName: "execute_tools",
        timestamp: Date.now(),
      });
    }
  };

  const handleContentDelta = (content: StreamingContent) => {
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((part) =>
          typeof part === "string"
            ? part
            : typeof part?.text === "string"
            ? part.text
            : ""
        )
        .join("");
    } else if (isTextObject(content) && typeof content.text === "string") {
      text = content.text;
    }

    if (!text) return;
    ensureTextMessageStarted();
    assistantContent += text;
    writeEvent({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: assistantMessageId,
      delta: text,
      timestamp: Date.now(),
    });
  };

  const handleToolCallDelta = (toolCallDelta: ToolCallDelta) => {
    if (!captureToolCalls) return;
    try {
      const index =
        typeof toolCallDelta.index === "number"
          ? toolCallDelta.index
          : toolCallIndexes.length;
      const state = ensureToolCallState(index);

      if (toolCallDelta.id) {
        state.id = toolCallDelta.id;
      }

      if (toolCallDelta.function?.name) {
        state.name = toolCallDelta.function.name;
      }

      const argsDelta = normalizeToolDelta(toolCallDelta.function?.arguments);
      if (!argsDelta) return;

      ensureToolStepStarted();
      if (!state.started) {
        state.started = true;
        writeEvent({
          type: EventType.TOOL_CALL_START,
          toolCallId: state.id,
          toolCallName: state.name || "execute_tool",
          parentMessageId: null,
          timestamp: Date.now(),
        });
      }

      const uniqueDelta = dedupeChunk(state.args, argsDelta);
      if (uniqueDelta) {
        state.args += uniqueDelta;
        writeEvent({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: state.id,
          delta: uniqueDelta,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      const details =
        error instanceof Error ? error.message : "Unknown tool delta error";
      reportToolDeltaError(details);
    }
  };

  while (!done && !shouldAbortStream) {
    const { value, done: readerDone } = await reader.read();
    if (value) {
      const chunk = decoder.decode(value, { stream: true });
      rawSseText += chunk;
      buffer += chunk;
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            done = true;
            break;
          }

          try {
            const parsed: StreamChunk = JSON.parse(data);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;
            if (delta?.content) {
              handleContentDelta(delta.content);
            }

            if (Array.isArray(delta?.tool_calls)) {
              delta.tool_calls.forEach((toolDelta) =>
                handleToolCallDelta(toolDelta)
              );
            }

            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
            }
          } catch (parseError) {
            logger.error("[Agent] Failed to parse streaming chunk", parseError);
            reportStreamParseError(
              parseError instanceof Error ? parseError.message : "Unknown"
            );
          }
        }
      }
    }

    if (readerDone) {
      break;
    }
  }

  if (shouldAbortStream) {
    return {
      content: assistantContent,
      toolCalls: captureToolCalls ? [] : undefined,
      finishReason: "error",
      toolStepStarted,
      rawSseText,
    };
  }

  const trailing = decoder.decode();
  if (trailing) {
    rawSseText += trailing;
  }

  if (assistantMessageStarted) {
    writeEvent({
      type: EventType.TEXT_MESSAGE_END,
      messageId: assistantMessageId,
      timestamp: Date.now(),
    });
  }

  toolCallStates.forEach((state) => {
    if (state.started) {
      writeEvent({
        type: EventType.TOOL_CALL_END,
        toolCallId: state.id,
        timestamp: Date.now(),
      });
    }
  });

  const aggregatedToolCalls = toolCallIndexes
    .map((index) => toolCallStates.get(index))
    .filter((state): state is ToolCallState => Boolean(state))
    .map((state) => ({
      id: state.id,
      type: "function",
      function: {
        name: state.name,
        arguments: state.args,
      },
    }));

  if (requestBodyString && model && rawSseText) {
    try {
      const verificationResult = await verifyChatMessage(
        requestBodyString,
        rawSseText,
        model
      );
      const verificationMetadata: VerificationMetadata = {
        source: "near-ai-cloud",
        status: verificationResult.verified ? "verified" : "failed",
        messageId: assistantMessageId,
        requestHash: verificationResult.requestHash,
        responseHash: verificationResult.responseHash,
        chatId: verificationResult.chatId || undefined,
        error: verificationResult.error ?? undefined,
      };
      writeEvent({
        type: EventType.VERIFICATION,
        verification: verificationMetadata,
        messageId: assistantMessageId,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.warn("[Agent] Verification failed", error);
    }
  }

  return {
    content: assistantContent,
    toolCalls: captureToolCalls ? aggregatedToolCalls : undefined,
    finishReason,
    toolStepStarted,
    rawSseText,
  };
}
