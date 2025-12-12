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
import { executeToolCallsWithEvents } from "@/server/agent/tools";
import {
  buildCompletionRequest,
  registerVerificationSession,
} from "@/server/agent/verification-flow";
import { runCompletion } from "@/server/agent/completion";
import { startSseSession, createEventWriter } from "@/server/agent/sse";
import { validateAgentRequest } from "@/server/agent/validation";
import type { StreamResult, ToolMessage } from "@/server/agent/types";
import type { VerificationResult } from "@/types/verification";

const MAX_TOOL_ITERATIONS = 10;

type VerificationStage =
  | "initial_reasoning"
  | "final_response"
  | `tool_round_${number}`;

function getVerificationStage(
  iteration: number,
  hasToolCalls: boolean
): VerificationStage {
  if (iteration === 0 && hasToolCalls) {
    return "initial_reasoning";
  }
  if (iteration === 0 && !hasToolCalls) {
    return "final_response";
  }
  return `tool_round_${iteration}`;
}

async function verifyCompletionResult({
  client,
  result,
  requestBodyString,
  stage,
  writeEvent,
}: {
  client: ReturnType<typeof getNearAIClient>;
  result: StreamResult;
  requestBodyString: string;
  stage: VerificationStage;
  writeEvent: (event: AGUIEvent) => void;
}): Promise<VerificationResult | null> {
  if (!result.verificationId || !result.rawSseText) {
    return null;
  }

  try {
    const verificationResult = await client.verifyChatPayload({
      requestBody: requestBodyString,
      responseText: result.rawSseText,
      chatId: result.verificationId,
      model: AGENT_MODEL,
    });

    if (verificationResult) {
      console.log(`[Agent] ${stage} verification result`, {
        verificationId: result.verificationId,
        status: verificationResult.status,
      });
      writeEvent({
        type: EventType.CUSTOM,
        name: "verification",
        value: { ...verificationResult, stage },
        timestamp: Date.now(),
      });
    }

    return verificationResult;
  } catch (error) {
    console.warn(`[Agent] ${stage} verification failed`, error);
    return null;
  }
}

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

    console.log("[Agent] Tool choice:", toolChoice);
    if (body.verificationId) {
      console.log("[verification][agent] request prepared", {
        verificationId: body.verificationId,
      });
    }

    const sse = startSseSession({ req, res, validated });
    const baseWriteEvent = sse.writeEvent;
    let terminalEventEmitted = false;

    const safeWriteEvent = (event: AGUIEvent) => {
      const isTerminal =
        event.type === EventType.RUN_ERROR ||
        event.type === EventType.RUN_FINISHED;

      if (terminalEventEmitted) {
        if (isTerminal) {
          console.warn(
            `[Agent] Suppressing duplicate terminal event: ${event.type}`
          );
        } else {
          console.warn(`[Agent] Suppressing event after terminal: ${event.type}`);
        }
        return;
      }

      if (isTerminal) {
        terminalEventEmitted = true;
      }

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

    let iteration = 0;

    while (iteration < MAX_TOOL_ITERATIONS) {
      const { requestBodyString, requestHash } = buildCompletionRequest({
        model: AGENT_MODEL,
        messages: currentMessages,
        tools: baseTools,
        toolChoice: baseToolChoice,
      });

      const { verificationId, nonce } =
        iteration === 0
          ? (() => {
              if (body.verificationId) {
                client.createSession(body.verificationId, body.verificationNonce);
                client.updateSessionHashes(body.verificationId, {
                  requestHash,
                });
              }
              return {
                verificationId: body.verificationId,
                nonce: body.verificationNonce,
              };
            })()
          : await registerVerificationSession({
              runtimeBaseUrl,
              baseVerificationId: body.verificationId,
              requestHash,
              iteration,
            });

      console.log(`[Agent] Iteration ${iteration}`, {
        messageCount: currentMessages.length,
        verificationId,
      });

      const result = await runCompletion({
        client,
        requestBodyString,
        requestHash,
        verificationId,
        verificationNonce: nonce,
        writeEvent,
        captureToolCalls: true,
      });

      if (result.finishReason === "error") {
        closeStream();
        return;
      }

      const hasToolCalls =
        Array.isArray(result.toolCalls) && result.toolCalls.length > 0;

      await verifyCompletionResult({
        client,
        result,
        requestBodyString,
        stage: getVerificationStage(iteration, hasToolCalls),
        writeEvent,
      });

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

      const verificationContext =
        result.verificationId || result.lastVerification?.messageId
          ? {
              verificationId: result.verificationId,
              messageId:
                result.lastVerification?.messageId ?? result.verificationId,
            }
          : undefined;

      const toolMessages: ToolMessage[] = await executeToolCallsWithEvents({
        toolCalls: result.toolCalls!,
        runtimeBaseUrl,
        writeEvent,
        verificationContext,
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
      console.warn("[Agent] Hit max tool iterations", { iteration });
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

    closeStream();
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (!stream) {
      if (error instanceof Error && error.name === "AbortError") {
        return res.status(504).json({ error: "Upstream request timed out" });
      }
      const statusCode = (error as any)?.statusCode ?? 500;
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

    console.error("[Agent] Error:", error);
    writeEvent({
      type: EventType.RUN_ERROR,
      message: errorMessage,
      code: "AGENT_ERROR",
      timestamp: Date.now(),
    });
    closeStream();
  }
}
