import { calculateRequestHash } from "@/lib/near-ai/verification/hashes";
import type { CompletionMessage } from "@/types/agui-events";
import {
  ChatCompletionRequestInput,
  normalizeChatCompletionRequest,
  serializeChatCompletionRequest,
} from "@/lib/near-ai/request";

export type CompletionRequest = {
  requestBodyString: string;
  requestHash: string;
};

type CompletionRequestMessage = {
  role: string;
  content?: string | null;
  tool_calls?: CompletionMessage["tool_calls"];
  tool_call_id?: string;
};

export function buildCompletionRequest({
  messages,
  model,
  tools,
  toolChoice,
}: {
  messages: CompletionRequestMessage[];
  model: string;
  tools?: ChatCompletionRequestInput["tools"];
  toolChoice?: ChatCompletionRequestInput["tool_choice"];
}): CompletionRequest {
  const toolsArray = Array.isArray(tools) ? tools : undefined;
  const requestBody = normalizeChatCompletionRequest({
    model,
    messages,
    stream: true,
    ...(toolsArray ? { tools: toolsArray } : {}),
    ...(toolChoice !== undefined && toolChoice !== null
      ? { tool_choice: toolChoice }
      : {}),
  });

  const requestBodyString = serializeChatCompletionRequest(requestBody);
  const requestHash = calculateRequestHash(requestBodyString);

  return { requestBodyString, requestHash };
}
