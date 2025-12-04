/**
 * NEAR AI Cloud Agent API Route using AG-UI Protocol
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { EventType } from "@/types/agui-events";
import { AGENT_MODEL, buildAgentRequest } from "@/server/tools";
import { computeRequestHash, verificationService } from "@/verification/server";
import { getNearAIClient } from "@/lib/near-ai/client";
import { executeToolCallsWithEvents } from "@/server/agent/tools";
import {
  finalizeVerifications,
  performSecondCompletion,
} from "@/server/agent/verification-flow";
import {
  getStreamingResponse,
  consumeStream,
} from "@/server/agent/streaming";
import { startSseSession, createEventWriter } from "@/server/agent/sse";
import { validateAgentRequest } from "@/server/agent/validation";
import type { ToolMessage } from "@/server/agent/types";

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
    const { requestBody, toolChoice } = buildAgentRequest({
      messages: body.messages,
      state: body.state,
      model: AGENT_MODEL,
    });
    const requestBodyString = JSON.stringify(requestBody);
    const requestHash = computeRequestHash(requestBodyString);

    if (body.verificationId) {
      verificationService.registerSession({
        verificationId: body.verificationId,
        nonce: body.verificationNonce,
        requestHash,
      });
    }

    console.log("[Agent] Tool choice:", toolChoice);
    if (body.verificationId) {
      console.log("[verification][agent] request prepared", {
        verificationId: body.verificationId,
      });
    }

    const client = getNearAIClient();
    const nearAIResponse = await getStreamingResponse(client, {
      requestBodyString,
      verificationId: body.verificationId,
      verificationNonce: body.verificationNonce,
    });

    const sse = startSseSession({ req, res, validated });
    writeEvent = sse.writeEvent;
    closeStream = sse.closeStream;
    stream = sse.stream;

    writeEvent({
      type: EventType.RUN_STARTED,
      threadId: thread,
      runId: run,
      timestamp: Date.now(),
    });

    const firstResult = await consumeStream({
      response: nearAIResponse,
      writeEvent,
      captureToolCalls: true,
      sessionVerificationId: body.verificationId,
    });

    if (
      !firstResult.content &&
      (!firstResult.toolCalls || firstResult.toolCalls.length === 0) &&
      firstResult.finishReason !== "tool_calls"
    ) {
      writeEvent({
        type: EventType.RUN_ERROR,
        message: "No usable data in streaming response",
        code: "EMPTY_STREAM",
        timestamp: Date.now(),
      });
      writeEvent({
        type: EventType.RUN_FINISHED,
        threadId: thread,
        runId: run,
        timestamp: Date.now(),
      });
      closeStream();
      return;
    }

    let secondVerificationId: string | undefined;
    let secondNonce: string | undefined;
    let secondRemoteVerificationId: string | undefined;

    if (Array.isArray(firstResult.toolCalls) && firstResult.toolCalls.length) {
      const toolMessages: ToolMessage[] = await executeToolCallsWithEvents({
        toolCalls: firstResult.toolCalls,
        runtimeBaseUrl,
        writeEvent,
      });

      if (firstResult.toolStepStarted) {
        writeEvent({
          type: EventType.STEP_FINISHED,
          stepName: "execute_tools",
          timestamp: Date.now(),
        });
      }

      const {
        secondId,
        nonce,
        remoteVerificationId,
      } = await performSecondCompletion({
        client,
        runtimeBaseUrl,
        requestMessages: requestBody.messages,
        toolCalls: firstResult.toolCalls,
        toolMessages,
        writeEvent,
        baseVerificationId: body.verificationId,
      });

      secondVerificationId = secondId;
      secondNonce = nonce;
      secondRemoteVerificationId = remoteVerificationId;
    }

    await finalizeVerifications({
      initialVerificationId: body.verificationId,
      initialRemoteId: firstResult.verificationId,
      initialNonce: body.verificationNonce,
      secondVerificationId,
      secondRemoteVerificationId,
      secondNonce,
      writeEvent,
    });

    writeEvent({
      type: EventType.RUN_FINISHED,
      threadId: thread,
      runId: run,
      timestamp: Date.now(),
    });

    closeStream();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (!stream) {
      if (error instanceof Error && error.name === "AbortError") {
        return res.status(504).json({ error: "Upstream request timed out" });
      }
      const statusCode = (error as any)?.statusCode ?? 500;
      return res.status(statusCode).json({ error: errorMessage });
    }

    const safeEventWriter =
      typeof writeEvent === "function"
        ? writeEvent
        : createEventWriter(res, stream);

    if (error instanceof Error && error.name === "AbortError") {
      safeEventWriter({
        type: EventType.RUN_ERROR,
        message: "Upstream request timed out",
        code: "TIMEOUT",
        timestamp: Date.now(),
      });
      safeEventWriter({
        type: EventType.RUN_FINISHED,
        threadId: thread,
        runId: run,
        timestamp: Date.now(),
      });
      return closeStream();
    }

    console.error("[Agent] Error:", error);
    safeEventWriter({
      type: EventType.RUN_ERROR,
      message: errorMessage,
      code: "AGENT_ERROR",
      timestamp: Date.now(),
    });
    closeStream();
  }
}
