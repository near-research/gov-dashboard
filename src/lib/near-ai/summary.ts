import {
  ChatCompletionRequestInput,
  normalizeChatCompletionRequest,
  serializeChatCompletionRequest,
  type NormalizedChatCompletionRequest,
} from "./request";
import { sha256sum } from "./verification/hash";

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

  return { request, serialized, hash };
}
