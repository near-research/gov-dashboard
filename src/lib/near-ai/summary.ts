import {
  ChatCompletionRequestInput,
  normalizeChatCompletionRequest,
  serializeChatCompletionRequest,
  type NormalizedChatCompletionRequest,
} from "./request";
import { sha256sum } from "./verification/hash";
import { logger } from "@/lib/logger";

export interface SummaryRequestOptions {
  model: string;
  userPrompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface PreparedSummaryRequest {
  request: NormalizedChatCompletionRequest;
  serialized: string;
  hash: string;
}

export function prepareSummaryRequest(
  options: SummaryRequestOptions
): PreparedSummaryRequest {
  const messages: ChatCompletionRequestInput["messages"] = [];

  if (options.systemPrompt) {
    messages.push({
      role: "system",
      content: options.systemPrompt,
    });
  }

  messages.push({
    role: "user",
    content: options.userPrompt,
  });

  const request = normalizeChatCompletionRequest({
    model: options.model,
    messages,
    stream: options.stream ?? true,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
  });

  const serialized = serializeChatCompletionRequest(request);
  const hash = sha256sum(serialized);

  logger.debug("[RequestHash] Normalized request payload for hashing", request);
  logger.debug("[RequestHash] Serialized request body for hashing", serialized);
  logger.debug("[RequestHash] Request hash (serialized payload)", hash);

  return { request, serialized, hash };
}
