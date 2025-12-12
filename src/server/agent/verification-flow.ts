import { AGENT_MODEL } from "@/server/tools";
import { getNearAIClient } from "@/lib/near-ai";
import { calculateRequestHash } from "@/verification/hashes";
import type { CompletionMessage } from "@/types/agui-events";

export type CompletionRequest = {
  requestBodyString: string;
  requestHash: string;
};

export async function registerVerificationSession({
  runtimeBaseUrl,
  baseVerificationId,
  requestHash,
  iteration,
}: {
  runtimeBaseUrl: string;
  baseVerificationId: string | undefined;
  requestHash: string;
  iteration: number;
}): Promise<{ verificationId?: string; nonce?: string }> {
  if (!baseVerificationId) {
    return { verificationId: undefined, nonce: undefined };
  }

  const verificationId =
    iteration === 0
      ? baseVerificationId
      : `${baseVerificationId}-round-${iteration}`;

  let nonce: string | undefined;

  if (iteration > 0) {
    try {
      const response = await fetch(
        `${runtimeBaseUrl}/api/verification/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verificationId }),
        }
      );
      if (response.ok) {
        const payload = (await response.json()) as { nonce?: string };
        nonce = payload?.nonce;
      } else {
        console.error("[Agent] Failed to register verification session", {
          iteration,
          status: response.status,
        });
      }
    } catch (error) {
      console.error("[Agent] Error registering verification session", error);
    }
  }

  const client = getNearAIClient();
  client.createSession(verificationId, nonce);
  client.updateSessionHashes(verificationId, { requestHash });

  return { verificationId, nonce };
}

export function buildCompletionRequest({
  messages,
  model,
  tools,
  toolChoice,
}: {
  messages: Array<{
    role: string;
    content?: string | null;
    tool_calls?: CompletionMessage["tool_calls"];
    tool_call_id?: string;
  }>;
  model: string;
  tools?: unknown;
  toolChoice?: unknown;
}): CompletionRequest {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };

  if (tools) {
    requestBody.tools = tools;
  }
  if (toolChoice) {
    requestBody.tool_choice = toolChoice;
  }

  const requestBodyString = JSON.stringify(requestBody);
  const requestHash = calculateRequestHash(requestBodyString);

  return { requestBodyString, requestHash };
}
