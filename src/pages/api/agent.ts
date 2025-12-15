/**
 * NEAR AI Cloud Agent API Route using AG-UI Protocol
 */

import type { NextApiRequest, NextApiResponse } from "next";
import {
  CompletionToolCall,
  EventType,
  type AGUIEvent,
} from "@/types/agui-events";
import { AGENT_MODEL, buildAgentRequest } from "@/server/tools";
import { getNearAIClient } from "@/lib/near-ai";
import { executeToolCallsWithEvents } from "./agent/server/tools";
import { buildCompletionRequest } from "./agent/server/verification-flow";
import { runCompletion } from "./agent/server/completion";
import { startSseSession, createEventWriter } from "./agent/server/sse";
import { validateAgentRequest } from "./agent/server/validation";
import type { StreamResult, ToolMessage } from "./agent/server/types";
import { telemetry } from "@/lib/telemetry";
import { logger } from "@/lib/logger";
import { MAX_TOOL_ITERATIONS } from "@/constants/agent";

const extractStatusCode = (value: unknown): number => {
  if (
    typeof value === "object" &&
    value !== null &&
    "statusCode" in value &&
    typeof (value as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (value as { statusCode?: number }).statusCode ?? 500;
  }
  return 500;
};


export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  let writeEvent = createEventWriter(res, null);
  let closeStream = () => {
    if (!res.writableEnded) {
      res.end();
    }
  };
  let stream: ReturnType<typeof startSseSession>["stream"] | null = null;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const validated = validateAgentRequest(req);
  if (!validated.ok) {
    return res.status(validated.status).json({ error: validated.error });
  }

  if (!process.env.NEAR_AI_CLOUD_API_KEY) {
    return res
      .status(500)
      .json({ error: "Missing NEAR_AI_CLOUD_API_KEY environment variable" });
  }

  const { body, thread, run, runtimeBaseUrl } = validated;
  const startTime = Date.now();
  telemetry.agentRunStarted(run, thread);
  let iteration = 0;

  try {
    const client = getNearAIClient();
    const { requestBody, toolChoice } = buildAgentRequest({
      messages: body.messages,
      state: body.state,
      model: AGENT_MODEL,
    });
    const baseTools = requestBody.tools;
    const baseToolChoice = requestBody.tool_choice;
    type AgentConversationMessage = {
      role: string;
      content: string;
      tool_calls?: CompletionToolCall[];
      tool_call_id?: string;
    };

    let currentMessages: AgentConversationMessage[] = requestBody.messages;

    logger.debug("[Agent] Tool choice", { toolChoice });

    const sse = startSseSession({ req, res, validated });
    const baseWriteEvent = sse.writeEvent;
    let terminalEventEmitted = false;

    const safeWriteEvent = (event: AGUIEvent) => {
      const isTerminal =
        event.type === EventType.RUN_ERROR ||
        event.type === EventType.RUN_FINISHED;

      if (terminalEventEmitted) {
        if (isTerminal) {
          logger.warn(
            `[Agent] Suppressing duplicate terminal event: ${event.type}`
          );
        } else {
          logger.warn(
            `[Agent] Suppressing event after terminal: ${event.type}`
          );
        }
        return;
      }

      if (isTerminal) {
        terminalEventEmitted = true;
      }

      telemetry.track("agent.event", {
        runId: run,
        threadId: thread,
        eventType: event.type,
        iteration,
      });

      baseWriteEvent(event);
    };

    writeEvent = safeWriteEvent;
    closeStream = sse.closeStream;
    stream = sse.stream;

    writeEvent({
      type: EventType.RUN_STARTED,
      threadId: thread,
      runId: run,
      parentRunId: validated.body.parentRunId,
      timestamp: Date.now(),
    });

    while (iteration < MAX_TOOL_ITERATIONS) {
      const { requestBodyString } = buildCompletionRequest({
        model: AGENT_MODEL,
        messages: currentMessages,
        tools: baseTools,
        toolChoice: baseToolChoice,
      });

      logger.debug(`[Agent] Iteration ${iteration}`, {
        messageCount: currentMessages.length,
      });

      const result = await runCompletion({
        client,
        requestBodyString,
        writeEvent,
        captureToolCalls: true,
      });

      if (result.finishReason === "error") {
        telemetry.agentRunFailed(
          run,
          "Completion stream reported error",
          iteration
        );
        closeStream();
        return;
      }

      const hasToolCalls =
        Array.isArray(result.toolCalls) && result.toolCalls.length > 0;

      if (
        iteration === 0 &&
        !result.content &&
        !hasToolCalls &&
        result.finishReason !== "tool_calls"
      ) {
        writeEvent({
          type: EventType.RUN_ERROR,
          message: "No usable data in streaming response",
          code: "EMPTY_STREAM",
          timestamp: Date.now(),
        });
        closeStream();
        return;
      }

      if (!hasToolCalls) {
        break;
      }

      const toolMessages: ToolMessage[] = await executeToolCallsWithEvents({
        runId: run,
        toolCalls: result.toolCalls!,
        runtimeBaseUrl,
        writeEvent,
      });

      writeEvent({
        type: EventType.STEP_FINISHED,
        stepName: `tool_execution_${iteration}`,
        timestamp: Date.now(),
      });

      currentMessages = [
        ...currentMessages,
        {
          role: "assistant",
          content: result.content ?? "",
          tool_calls: result.toolCalls,
        },
        ...toolMessages.map((tm) => ({
          role: "tool",
          tool_call_id: tm.tool_call_id,
          content: tm.content,
        })),
      ];

      iteration++;
    }

    if (iteration >= MAX_TOOL_ITERATIONS) {
      logger.warn("[Agent] Hit max tool iterations", { iteration });
      writeEvent({
        type: EventType.CUSTOM,
        name: "warning",
        value: { message: "Maximum tool iterations reached", iteration },
        timestamp: Date.now(),
      });
    }

    writeEvent({
      type: EventType.RUN_FINISHED,
      threadId: thread,
      runId: run,
      timestamp: Date.now(),
    });

    telemetry.agentRunCompleted(run, iteration, Date.now() - startTime);

    closeStream();
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    telemetry.agentRunFailed(run, errorMessage, iteration);

    if (!stream) {
      if (error instanceof Error && error.name === "AbortError") {
        return res.status(504).json({ error: "Upstream request timed out" });
      }
      const statusCode = extractStatusCode(error);
      return res.status(statusCode).json({ error: errorMessage });
    }

    if (error instanceof Error && error.name === "AbortError") {
      writeEvent({
        type: EventType.RUN_ERROR,
        message: "Upstream request timed out",
        code: "TIMEOUT",
        timestamp: Date.now(),
      });
      return closeStream();
    }

    logger.error("[Agent] Error", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    writeEvent({
      type: EventType.RUN_ERROR,
      message: errorMessage,
      code: "AGENT_ERROR",
      timestamp: Date.now(),
    });
    closeStream();
  }
}
