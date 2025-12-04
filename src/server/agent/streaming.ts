import { EventType, type AGUIEvent } from "@/types/agui-events";
import { extractVerificationMetadata } from "@/verification/normalize";
import type { StreamResult } from "./types";
import { generateId } from "./ids";
import { createHash } from "crypto";
import { updateVerificationHashes } from "@/verification/server";

export async function getStreamingResponse(
  client: { chatCompletionsStream: (body: any, opts?: any) => Promise<Response> },
  {
    requestBodyString,
    verificationId,
    verificationNonce,
  }: {
    requestBodyString: string;
    verificationId?: string;
    verificationNonce?: string;
  }
): Promise<Response> {
  try {
    const response = await client.chatCompletionsStream(requestBodyString, {
      verificationId,
      verificationNonce,
    });
    if (!response.body) {
      throw new Error("NEAR AI response missing body");
    }
    return response;
  } catch (error) {
    console.error("[Agent] NEAR AI API error:", error);
    const statusCode =
      error instanceof Error && "statusCode" in error
        ? (error as { statusCode?: number }).statusCode || 500
        : 500;
    const details = error instanceof Error ? error.message : "Unknown error";
    const err = new Error(`NEAR AI API error: ${statusCode} - ${details}`);
    (err as any).statusCode = statusCode;
    throw err;
  }
}

export async function consumeStream({
  response,
  writeEvent,
  captureToolCalls = false,
  sessionVerificationId,
}: {
  response: Response;
  writeEvent: (event: AGUIEvent) => void;
  captureToolCalls?: boolean;
  sessionVerificationId?: string;
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
  let verificationId: string | undefined;
  let finishReason: string | null = null;
  let streamParseErrorReported = false;
  let toolDeltaErrorReported = false;

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
    console.warn("[Agent] Streaming parse error", { details });
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
    console.warn("[Agent] Tool delta processing error", { details });
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

  const handleContentDelta = (content: any) => {
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
    } else if (content?.text) {
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

  const handleToolCallDelta = (toolCallDelta: any) => {
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

  while (!done) {
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
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;
            const verification = extractVerificationMetadata(parsed, delta);

            if (verification?.messageId) {
              verificationId = verification.messageId;
            }

            if (delta?.content) {
              handleContentDelta(delta.content);
            }

            if (Array.isArray(delta?.tool_calls)) {
              delta.tool_calls.forEach((toolDelta: any) =>
                handleToolCallDelta(toolDelta)
              );
            }

            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
            }
          } catch (parseError) {
            console.error("[Agent] Failed to parse streaming chunk", parseError);
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

  if (sessionVerificationId && rawSseText) {
    const responseHash = createHash("sha256")
      .update(rawSseText)
      .digest("hex");
    updateVerificationHashes(sessionVerificationId, {
      responseHash,
    });
  }

  return {
    content: assistantContent,
    toolCalls: captureToolCalls ? aggregatedToolCalls : undefined,
    finishReason,
    verificationId,
    toolStepStarted,
  };
}
