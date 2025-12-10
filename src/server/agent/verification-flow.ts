import { AGENT_MODEL } from "@/server/tools";
import { getNearAIClient } from "@/lib/near-ai";
import { calculateRequestHash } from "@/verification/hashes";
import {
  EventType,
  type AGUIEvent,
  type CompletionMessage,
} from "@/types/agui-events";
import { getStreamingResponse, consumeStream } from "./streaming";
import type { VerificationPayload, VerificationStage } from "@/types/verification";
import type { ToolMessage } from "./types";

export async function registerSecondVerificationSession(
  runtimeBaseUrl: string,
  baseVerificationId: string | undefined,
  secondRequestHash: string
) {
  if (!baseVerificationId) {
    return { secondVerificationId: undefined, secondNonce: undefined };
  }

  const secondVerificationId = `${baseVerificationId}-synthesis`;
  let secondNonce: string | undefined;

  try {
    const secondNonceResp = await fetch(
      `${runtimeBaseUrl}/api/verification/session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId: secondVerificationId }),
      }
    );
    if (!secondNonceResp.ok) {
      console.error("[Agent] Failed to register second verification session", {
        status: secondNonceResp.status,
      });
    } else {
      const noncePayload = (await secondNonceResp.json()) as { nonce?: string };
      secondNonce = noncePayload?.nonce;
    }
  } catch (error) {
    console.error(
      "[Agent] Error registering second verification session",
      error
    );
  }

  const client = getNearAIClient();
  client.createSession(secondVerificationId, secondNonce);
  client.updateSessionHashes(secondVerificationId, { requestHash: secondRequestHash });

  return { secondVerificationId, secondNonce };
}

const finalizeStageWithHashes = async (args: {
  verificationId?: string;
  remoteMessageId?: string;
  nonce?: string;
  model: string;
  stage: VerificationStage;
  signingAlgo?: string;
}): Promise<VerificationPayload | null> => {
  const { verificationId, remoteMessageId, nonce, model, stage, signingAlgo } = args;
  if (!verificationId || !remoteMessageId) {
    return null;
  }

  const client = getNearAIClient();
  const canonicalHashes = await client.fetchCanonicalHashes({
    remoteMessageId,
    fallbackId: verificationId,
    model,
    signingAlgo,
  });

  if (!canonicalHashes) {
    return null;
  }

  client.updateSessionHashes(verificationId, {
    requestHash: canonicalHashes.requestHash,
    responseHash: canonicalHashes.responseHash,
  });

  return {
    messageId: remoteMessageId,
    verificationId,
    requestHash: canonicalHashes.requestHash,
    responseHash: canonicalHashes.responseHash,
    nonce: nonce ?? null,
    stage,
  };
};

export async function performSecondCompletion({
  client,
  runtimeBaseUrl,
  requestMessages,
  toolCalls,
  toolMessages,
  writeEvent,
  baseVerificationId,
}: {
  client: {
    chatCompletionsStream: (body: any, opts?: any) => Promise<Response>;
  };
  runtimeBaseUrl: string;
  requestMessages: any[];
  toolCalls: NonNullable<CompletionMessage["tool_calls"]>;
  toolMessages: ToolMessage[];
  writeEvent: (event: AGUIEvent) => void;
  baseVerificationId?: string;
}) {
  const secondRequestBody = {
    model: AGENT_MODEL,
    messages: [
      ...requestMessages,
      {
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      },
      ...toolMessages,
    ],
    stream: true,
  };

  const secondRequestBodyString = JSON.stringify(secondRequestBody);
  const secondRequestHash = calculateRequestHash(secondRequestBodyString);

  const { secondVerificationId, secondNonce } =
    await registerSecondVerificationSession(
      runtimeBaseUrl,
      baseVerificationId,
      secondRequestHash
    );

  const secondNearAIResponse = await getStreamingResponse(client, {
    requestBodyString: secondRequestBodyString,
    verificationId: secondVerificationId,
    verificationNonce: secondNonce,
  });

  const secondStream = await consumeStream({
    response: secondNearAIResponse,
    writeEvent,
    sessionVerificationId: secondVerificationId,
    sessionRequestHash: secondRequestHash,
  });

  return {
    secondId: secondVerificationId,
    nonce: secondNonce,
    remoteVerificationId: secondStream.verificationId,
  };
}

export async function finalizeVerifications({
  initialVerificationId,
  initialRemoteId,
  initialNonce,
  secondVerificationId,
  secondRemoteVerificationId,
  secondNonce,
  signingAlgo,
  writeEvent,
}: {
  initialVerificationId?: string;
  initialRemoteId?: string;
  initialNonce?: string;
  secondVerificationId?: string;
  secondRemoteVerificationId?: string;
  secondNonce?: string;
  signingAlgo?: string;
  writeEvent: (event: AGUIEvent) => void;
}) {
  const initialPayload = await finalizeStageWithHashes({
    verificationId: initialVerificationId,
    remoteMessageId: initialRemoteId,
    nonce: initialNonce,
    model: AGENT_MODEL,
    stage: "initial_reasoning",
    signingAlgo,
  });

  if (initialPayload) {
    console.log(
      "[verification][agent] initial reasoning verified",
      initialPayload
    );
    writeEvent({
      type: EventType.CUSTOM,
      name: "verification",
      value: initialPayload,
      timestamp: Date.now(),
    });
  } else if (initialVerificationId || initialRemoteId) {
    console.warn(
      "[verification][agent] Unable to fetch canonical hashes for initial reasoning",
      { initialVerificationId, initialRemoteId }
    );
  }

  const secondPayload = await finalizeStageWithHashes({
    verificationId: secondVerificationId,
    remoteMessageId: secondRemoteVerificationId,
    nonce: secondNonce,
    model: AGENT_MODEL,
    stage: "final_synthesis",
    signingAlgo,
  });

  if (secondPayload) {
    console.log(
      "[verification][agent] second completion verified",
      secondPayload
    );
    writeEvent({
      type: EventType.CUSTOM,
      name: "verification",
      value: secondPayload,
      timestamp: Date.now(),
    });
  } else if (secondVerificationId || secondRemoteVerificationId) {
    console.warn(
      "[verification][agent] Unable to fetch canonical hashes for second completion",
      { secondVerificationId, secondRemoteVerificationId }
    );
  }
}
