import { PassThrough } from "stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { EventType, type AGUIEvent } from "@/types/agui-events";
import { getNearAIClient } from "@/lib/near-ai";
import type { ValidatedAgentRequest } from "./types";

export const createEventWriter =
  (res: NextApiResponse, stream: PassThrough | null) => (event: AGUIEvent) => {
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
  res: NextApiResponse;
  validated: Extract<ValidatedAgentRequest, { ok: true }>;
}) {
  let stream: PassThrough | null = new PassThrough();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  stream.pipe(res);

  let streamClosed = false;
  const closeStream = () => {
    if (!streamClosed) {
      streamClosed = true;
      if (stream && !stream.destroyed) {
        stream.end();
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  };

  req.on("close", () => {
    console.log("[Agent] Client disconnected");
    closeStream();
  });

  stream.on("error", (error) => {
    console.error("[Agent] Stream error:", error);
    closeStream();
  });

  const client = getNearAIClient();
  const maybeUpdateHashesFromEvent = (event: AGUIEvent) => {
    if (
      event.type === EventType.CUSTOM &&
      event.name === "verification" &&
      event.value &&
      typeof event.value === "object"
    ) {
      const verificationIdValue = (event.value as any).verificationId;
      const requestHashValue = (event.value as any).requestHash;
      const responseHashValue = (event.value as any).responseHash;

      if (typeof verificationIdValue === "string") {
        client.updateSessionHashes(verificationIdValue, {
          requestHash:
            typeof requestHashValue === "string" ? requestHashValue : undefined,
          responseHash:
            typeof responseHashValue === "string"
              ? responseHashValue
              : undefined,
        });
      }
    }
  };

  const writeEvent = (event: AGUIEvent) => {
    maybeUpdateHashesFromEvent(event);
    createEventWriter(res, stream)(event);
  };

  return {
    ...validated,
    stream,
    writeEvent,
    closeStream,
  };
}
