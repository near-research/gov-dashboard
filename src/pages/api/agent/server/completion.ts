import { getNearAIClient } from "@/lib/near-ai";
import { getStreamingResponse, consumeStream } from "./streaming";
import type { AGUIEvent } from "@/types/agui-events";
import type { StreamResult } from "./types";

export type CompletionParams = {
  client: ReturnType<typeof getNearAIClient>;
  requestBodyString: string;
  writeEvent: (event: AGUIEvent) => void;
  captureToolCalls: boolean;
};

export async function runCompletion({
  client,
  requestBodyString,
  writeEvent,
  captureToolCalls,
}: CompletionParams): Promise<StreamResult> {
  const response = await getStreamingResponse(client, {
    requestBodyString,
  });

  return consumeStream({
    response,
    writeEvent,
    captureToolCalls,
  });
}
