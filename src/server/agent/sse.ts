import { PassThrough } from "stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { EventType, type AGUIEvent } from "@/types/agui-events";
import { telemetry } from "@/lib/telemetry";
import type { ValidatedAgentRequest } from "./types";
import { SSE_KEEPALIVE_INTERVAL_MS } from "@/constants/agent";
import { logger } from "@/lib/logger";


export const createEventWriter =
  (res: NextApiResponse<void>, stream: PassThrough | null) =>
  (event: AGUIEvent) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    if (stream) {
      stream.write(payload);
    } else {
      res.write(payload);
    }
  };

export function startSseSession({
  req,
  res,
  validated,
}: {
  req: NextApiRequest;
  res: NextApiResponse<void>;
  validated: Extract<ValidatedAgentRequest, { ok: true }>;
}) {
  let stream: PassThrough | null = new PassThrough();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  stream.pipe(res);

  const writeKeepAlive = () => {
    const payload = ":keep-alive\n\n";
    if (stream && !stream.destroyed) {
      stream.write(payload);
    } else if (!res.writableEnded) {
      res.write(payload);
    }
  };
  const keepAliveTimer = setInterval(writeKeepAlive, SSE_KEEPALIVE_INTERVAL_MS);

  const { run, thread } = validated;
  telemetry.track("agent.sse.session.started", { runId: run, threadId: thread });

  let streamClosed = false;
  const closeStream = () => {
    if (!streamClosed) {
      streamClosed = true;
      clearInterval(keepAliveTimer);
      if (stream && !stream.destroyed) {
        stream.end();
      } else if (!res.writableEnded) {
        res.end();
      }
      stream = null;
    }
  };

  req.on("close", () => {
    logger.debug("[Agent] Client disconnected");
    telemetry.track("agent.sse.client_disconnected", {
      runId: validated.run,
      threadId: validated.thread,
    });
    closeStream();
  });

  stream.on("error", (error) => {
    logger.error("[Agent] Stream error:", error);
    telemetry.track("agent.sse.error", {
      runId: validated.run,
      threadId: validated.thread,
      error:
        error instanceof Error ? error.message : "Unknown SSE stream error",
    });
    closeStream();
  });

  const writeEvent = (event: AGUIEvent) => {
    createEventWriter(res, stream)(event);
  };

  return {
    ...validated,
    stream,
    writeEvent,
    closeStream,
  };
}
