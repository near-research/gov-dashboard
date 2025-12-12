import { getNearAIClient } from "@/lib/near-ai";
import { getStreamingResponse, consumeStream } from "./streaming";
import type { AGUIEvent } from "@/types/agui-events";
import type { StreamResult } from "@/server/agent/types";

export type CompletionParams = {
  client: ReturnType<typeof getNearAIClient>;
  requestBodyString: string;
  requestHash: string;
  verificationId?: string;
  verificationNonce?: string;
  writeEvent: (event: AGUIEvent) => void;
  captureToolCalls: boolean;
};

export async function runCompletion({
  client,
  requestBodyString,
  requestHash,
  verificationId,
  verificationNonce,
  writeEvent,
  captureToolCalls,
}: CompletionParams): Promise<StreamResult> {
  const response = await getStreamingResponse(client, {
    requestBodyString,
    verificationId,
    verificationNonce,
  });

  return consumeStream({
    response,
    writeEvent,
    captureToolCalls,
    sessionVerificationId: verificationId,
    sessionRequestHash: requestHash,
  });
}
