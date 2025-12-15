import type { NearAIClient } from "./client";
import { prepareSummaryRequest, type SummaryRequestOptions } from "./summary";
import { streamChatCompletion } from "./stream";
import { finalizeSummaryVerification } from "@/server/summaryVerification";

export interface SummaryFlowOptions extends SummaryRequestOptions {
  client: NearAIClient;
  origin?: string | null;
  verificationId: string;
}

export async function runSummaryFlow(options: SummaryFlowOptions) {
  const { request, serialized, hash } = prepareSummaryRequest(options);
  const { summary, chatId, responseText } = await streamChatCompletion(
    options.client,
    request
  );

  const verification = await finalizeSummaryVerification({
    origin: options.origin,
    model: options.model,
    verificationId: options.verificationId,
    requestBody: serialized,
    requestHash: hash,
    responseText,
    chatId,
  });

  return { summary, chatId, responseText, verification };
}
