/**
 * NEAR AI Cloud Agent API Route using AG-UI Protocol
 */

import { PassThrough } from "stream";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  EventType,
  type AGUIEvent,
  type CompletionMessage,
  type MessageRole,
  type AgentState,
} from "@/types/agui-events";
import {
  extractVerificationMetadata,
  normalizeSignaturePayload,
} from "@/utils/verification";
import {
  registerVerificationSession,
  updateVerificationHashes,
} from "@/server/verificationSessions";
import { extractHashesFromSignedText } from "@/utils/request-hash";

// Import from consolidated tools barrel
import { AGENT_MODEL, buildAgentRequest } from "@/server/tools";

// Import tool handlers
import {
  handleWriteProposal,
  handleScreenProposal,
} from "@/server/tools/proposals";
import {
  handleSearchDiscourse,
  handleGetDiscourseTopic,
  handleGetLatestTopics,
  handleSummarizeDiscussion,
  handleSummarizeReply,
} from "@/server/tools/discourse";
import { handleGetDoc, handleSearchDocs } from "@/server/tools/docs";

interface AgentRequestBody {
  messages: Array<{ role: MessageRole; content: string }>;
  threadId?: string;
  runId?: string;
  state?: Partial<AgentState>;
  verificationId?: string;
  verificationNonce?: string;
}

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || process.env.SITE_URL || "";

const NEAR_API_BASE = "https://cloud-api.near.ai/v1";

type ToolCallArgs = {
  title?: string;
  content?: string;
  query?: string;
  limit?: number;
  topic_id?: string;
  post_id?: string;
  doc_key?: string;
  topic?: string;
};

type ToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
};

// Generate unique IDs
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function fetchCanonicalHashes(
  preferredId: string | undefined,
  fallbackId: string | undefined,
  model: string
): Promise<{ requestHash: string; responseHash: string } | null> {
  const candidates = Array.from(
    new Set(
      [preferredId, fallbackId].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      )
    )
  );

  if (candidates.length === 0) {
    return null;
  }

  for (const id of candidates) {
    try {
      const signatureUrl = `${NEAR_API_BASE}/signature/${encodeURIComponent(
        id
      )}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`;
      const response = await fetch(signatureUrl, {
        headers: {
          Authorization: `Bearer ${process.env.NEAR_AI_CLOUD_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.warn(
          `[Agent] Failed to fetch signature for hash extraction (${id}): ${response.status}`
        );
        continue;
      }

      const data = await response.json();
      const signaturePayload =
        normalizeSignaturePayload(data.signature ?? data) ||
        normalizeSignaturePayload(data);
      const signedText =
        signaturePayload?.text ||
        (typeof data?.text === "string" ? data.text : null);
      const hashes = extractHashesFromSignedText(signedText);

      if (hashes) {
        return hashes;
      }

      console.warn("[Agent] Unable to parse hashes from signed text", {
        id,
      });
    } catch (error) {
      console.error("[Agent] Error fetching canonical hashes:", error);
    }
  }

  return null;
}

async function executeToolCall({
  toolCall,
  runtimeBaseUrl,
  writeEvent,
}: {
  toolCall: NonNullable<CompletionMessage["tool_calls"]>[number];
  runtimeBaseUrl: string;
  writeEvent: (event: AGUIEvent) => void;
}): Promise<ToolMessage | null> {
  const toolCallId = toolCall.id;
  const toolName = toolCall.function.name;
  let args: ToolCallArgs | null = null;

  try {
    args = JSON.parse(toolCall.function.arguments || "{}") as ToolCallArgs;
  } catch (parseError) {
    const errorMessage =
      parseError instanceof Error
        ? parseError.message
        : "Invalid tool arguments";
    const errorResult = {
      error: `Failed to parse tool arguments: ${errorMessage}`,
    };

    writeEvent({
      type: EventType.TOOL_CALL_RESULT,
      messageId: generateId("tool_result"),
      toolCallId,
      content: JSON.stringify(errorResult, null, 2),
      role: "tool",
      timestamp: Date.now(),
    });

    return {
      role: "tool",
      content: JSON.stringify(errorResult),
      tool_call_id: toolCallId,
    };
  }

  if (!args) {
    return null;
  }

  let result: Record<string, unknown> | null = null;

  // Proposal tools
  if (toolName === "screen_proposal" && args.title && args.content) {
    const { result: screenResult } = await handleScreenProposal({
      title: args.title,
      content: args.content,
    });
    result = { ...screenResult };

    writeEvent({
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/evaluation",
          value: screenResult.evaluation,
        },
      ],
      timestamp: Date.now(),
    });
  } else if (toolName === "write_proposal" && args.title && args.content) {
    const { result: writeResult } = await handleWriteProposal({
      title: args.title,
      content: args.content,
    });
    result = { ...writeResult };

    writeEvent({
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/title",
          value: args.title,
        },
        {
          op: "replace",
          path: "/content",
          value: args.content,
        },
      ],
      timestamp: Date.now(),
    });
  }

  // Discourse tools
  else if (toolName === "search_discourse" && args.query) {
    const { result: searchResult } = await handleSearchDiscourse({
      query: args.query,
      limit: args.limit,
    });
    result = { ...searchResult };
  } else if (toolName === "get_discourse_topic" && args.topic_id) {
    const { result: topicResult } = await handleGetDiscourseTopic({
      topic_id: args.topic_id,
    });
    result = { ...topicResult };
  } else if (toolName === "get_latest_topics") {
    const { result: latestResult } = await handleGetLatestTopics(
      { limit: args.limit },
      runtimeBaseUrl
    );
    result = { ...latestResult };
  } else if (toolName === "summarize_discussion" && args.topic_id) {
    const { result: summaryResult } = await handleSummarizeDiscussion(
      { topic_id: args.topic_id },
      runtimeBaseUrl
    );
    result = { ...summaryResult };
  } else if (toolName === "summarize_reply" && args.post_id) {
    const { result: replyResult } = await handleSummarizeReply(
      { post_id: args.post_id },
      runtimeBaseUrl
    );
    result = { ...replyResult };
  }

  // Docs tools
  else if (toolName === "get_doc" && args.doc_key) {
    const { result: docResult } = await handleGetDoc({ doc_key: args.doc_key });
    result = { ...docResult };
  } else if (toolName === "search_docs" && args.topic) {
    const { result: searchResult } = await handleSearchDocs({
      topic: args.topic,
    });
    result = { ...searchResult };
  }

  writeEvent({
    type: EventType.TOOL_CALL_RESULT,
    messageId: generateId("tool_result"),
    toolCallId,
    content: JSON.stringify(result, null, 2),
    role: "tool",
    timestamp: Date.now(),
  });

  return {
    role: "tool",
    content: JSON.stringify(result),
    tool_call_id: toolCallId,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body as AgentRequestBody;
  const thread = body.threadId || generateId("thread");
  const run = body.runId || generateId("run");
  const runtimeBaseUrl =
    APP_BASE_URL ||
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : "http://localhost:3000");
  let stream: PassThrough | null = null;
  let secondVerificationId: string | undefined;
  let secondNonce: string | undefined;
  let secondRemoteVerificationId: string | undefined;
  let closeStream = () => {
    if (stream && !stream.destroyed) {
      stream.end();
    } else if (!res.writableEnded) {
      res.end();
    }
  };
  try {
    const { messages, state, verificationId, verificationNonce } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Invalid request body",
        message: "messages array is required",
      });
    }

    console.log("[Agent] API called with:", {
      messagesCount: messages?.length,
      hasState: !!state,
      hasApiKey: !!process.env.NEAR_AI_CLOUD_API_KEY,
    });

    // Check for API key
    if (!process.env.NEAR_AI_CLOUD_API_KEY) {
      return res
        .status(500)
        .json({ error: "Missing NEAR_AI_CLOUD_API_KEY environment variable" });
    }

    const { requestBody, toolChoice } = buildAgentRequest({
      messages,
      state,
      model: AGENT_MODEL,
    });

    const requestBodyString = JSON.stringify(requestBody);

    if (verificationId) {
      registerVerificationSession(
        verificationId,
        verificationNonce,
        null,
        null
      );
    }

    console.log("[Agent] Tool choice:", toolChoice);
    if (verificationId) {
      console.log("[verification][agent] request prepared", {
        verificationId,
      });
    }

    // Direct fetch to NEAR AI Cloud (STREAMING)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const nearAIResponse = await fetch(
      "https://cloud-api.near.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEAR_AI_CLOUD_API_KEY}`,
          "Content-Type": "application/json",
          ...(verificationId ? { "X-Verification-Id": verificationId } : {}),
          ...(verificationNonce ? { "X-Nonce": verificationNonce } : {}),
        },
        body: requestBodyString,
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    console.log("[Agent] NEAR AI Response status:", nearAIResponse.status);

    if (!nearAIResponse.ok) {
      const errorText = await nearAIResponse.text();
      console.error(
        "[Agent] NEAR AI API error:",
        nearAIResponse.status,
        errorText
      );
      return res.status(500).json({
        error: `NEAR AI API error: ${nearAIResponse.status}`,
        details: errorText,
      });
    }

    if (!nearAIResponse.body) {
      console.error("[Agent] Streaming body missing");
      return res.status(500).json({
        error: "NEAR AI response missing body",
      });
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    stream = new PassThrough();
    stream.pipe(res);
    let streamClosed = false;
    closeStream = () => {
      if (!streamClosed) {
        streamClosed = true;
        if (stream && !stream.destroyed) {
          stream.end();
        } else {
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

    // Helper to write events
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
          updateVerificationHashes(verificationIdValue, {
            requestHash:
              typeof requestHashValue === "string"
                ? requestHashValue
                : undefined,
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
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      if (stream) {
        stream.write(payload);
      } else {
        res.write(payload);
      }
    };

    // Emit RUN_STARTED
    writeEvent({
      type: EventType.RUN_STARTED,
      threadId: thread,
      runId: run,
      timestamp: Date.now(),
    });

    const reader = nearAIResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    const assistantMessageId = generateId("msg");
    let assistantMessageStarted = false;
    let assistantContent = "";

    const dedupeChunk = (existing: string, delta: string) => {
      if (!delta) return "";
      if (!existing) return delta;
      let overlap = Math.min(existing.length, delta.length);
      while (overlap > 0) {
        if (
          existing.slice(existing.length - overlap) === delta.slice(0, overlap)
        ) {
          return delta.slice(overlap);
        }
        overlap -= 1;
      }
      return delta;
    };

    type ToolCallState = {
      id: string;
      name: string;
      args: string;
      started: boolean;
    };

    const toolCallStates = new Map<number, ToolCallState>();
    const toolCallIndexes: number[] = [];
    let toolStepStarted = false;

    const ensureTextMessageStarted = () => {
      if (!assistantMessageStarted) {
        assistantMessageStarted = true;
        writeEvent({
          type: EventType.TEXT_MESSAGE_START,
          messageId: assistantMessageId,
          role: "assistant",
          timestamp: Date.now(),
        });
      }
    };

    const ensureToolCallState = (index: number): ToolCallState => {
      if (!toolCallStates.has(index)) {
        const newState: ToolCallState = {
          id: generateId("tool_call"),
          name: "",
          args: "",
          started: false,
        };
        toolCallStates.set(index, newState);
        toolCallIndexes.push(index);
      }
      return toolCallStates.get(index)!;
    };

    const ensureToolStepStarted = () => {
      if (!toolStepStarted) {
        toolStepStarted = true;
        writeEvent({
          type: EventType.STEP_STARTED,
          stepName: "execute_tools",
          timestamp: Date.now(),
        });
      }
    };

    let remoteVerificationId: string | undefined;

    const handleContentDelta = (content: any) => {
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((part) =>
            typeof part === "string"
              ? part
              : typeof part?.text === "string"
              ? part.text
              : ""
          )
          .join("");
      } else if (content?.text) {
        text = content.text;
      }

      if (!text) return;
      ensureTextMessageStarted();
      assistantContent += text;
      writeEvent({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: assistantMessageId,
        delta: text,
        timestamp: Date.now(),
      });
    };

    const handleToolCallDelta = (toolCallDelta: any) => {
      const index =
        typeof toolCallDelta.index === "number"
          ? toolCallDelta.index
          : toolCallIndexes.length;
      const state = ensureToolCallState(index);

      if (toolCallDelta.id) {
        state.id = toolCallDelta.id;
      }

      if (toolCallDelta.function?.name) {
        state.name = toolCallDelta.function.name;
      }

      if (toolCallDelta.function?.arguments) {
        ensureToolStepStarted();
        if (!state.started) {
          state.started = true;
          writeEvent({
            type: EventType.TOOL_CALL_START,
            toolCallId: state.id,
            toolCallName: state.name || "execute_tool",
            parentMessageId: null,
            timestamp: Date.now(),
          });
        }

        const argsDelta = toolCallDelta.function.arguments;
        const uniqueDelta = dedupeChunk(state.args, argsDelta);
        if (uniqueDelta) {
          state.args += uniqueDelta;
          writeEvent({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: state.id,
            delta: uniqueDelta,
            timestamp: Date.now(),
          });
        }
      }
    };

    let finishReason: string | null = null;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) {
            continue;
          }

          if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              done = true;
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              const delta = choice?.delta;
              const verification = extractVerificationMetadata(parsed, delta);

              console.log("[Agent] Extracted verification:", {
                hasVerification: !!verification,
                messageId: verification?.messageId,
                parsedId: parsed.id,
              });

              if (verification?.messageId) {
                remoteVerificationId = verification.messageId;
              }

              if (delta?.content) {
                handleContentDelta(delta.content);
              }

              if (Array.isArray(delta?.tool_calls)) {
                delta.tool_calls.forEach((toolDelta: any) =>
                  handleToolCallDelta(toolDelta)
                );
              }

              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }
            } catch (parseError) {
              console.error(
                "[Agent] Failed to parse streaming chunk",
                parseError
              );
            }
          }
        }
      }

      if (readerDone) {
        break;
      }
    }

    decoder.decode();

    if (assistantMessageStarted) {
      writeEvent({
        type: EventType.TEXT_MESSAGE_END,
        messageId: assistantMessageId,
        timestamp: Date.now(),
      });
    }

    toolCallStates.forEach((state) => {
      if (state.started) {
        writeEvent({
          type: EventType.TOOL_CALL_END,
          toolCallId: state.id,
          timestamp: Date.now(),
        });
      }
    });

    const aggregatedToolCalls = toolCallIndexes
      .map((index) => toolCallStates.get(index))
      .filter((state): state is ToolCallState => Boolean(state))
      .map((state) => ({
        id: state.id,
        type: "function",
        function: {
          name: state.name,
          arguments: state.args,
        },
      }));

    const message: CompletionMessage = {
      content: assistantContent || undefined,
      tool_calls: aggregatedToolCalls.length ? aggregatedToolCalls : undefined,
    };

    if (
      !message.content &&
      (!message.tool_calls || message.tool_calls.length === 0) &&
      finishReason !== "tool_calls"
    ) {
      writeEvent({
        type: EventType.RUN_ERROR,
        message: "No usable data in streaming response",
        code: "EMPTY_STREAM",
        timestamp: Date.now(),
      });

      writeEvent({
        type: EventType.RUN_FINISHED,
        threadId: thread,
        runId: run,
        timestamp: Date.now(),
      });

      closeStream();
      return;
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      console.log(
        "[Agent] Tool calls detected, executing locally and making second completion",
        { count: message.tool_calls.length }
      );

      const toolMessages: ToolMessage[] = [];

      for (const toolCall of message.tool_calls) {
        const toolMessage = await executeToolCall({
          toolCall,
          runtimeBaseUrl,
          writeEvent,
        });
        if (toolMessage) {
          toolMessages.push(toolMessage);
        }
      }

      if (toolStepStarted) {
        writeEvent({
          type: EventType.STEP_FINISHED,
          stepName: "execute_tools",
          timestamp: Date.now(),
        });
      }

      const secondRequestBody = {
        model: AGENT_MODEL,
        messages: [
          ...requestBody.messages,
          {
            role: "assistant",
            content: null,
            tool_calls: message.tool_calls,
          },
          ...toolMessages,
        ],
        stream: true,
      };

      const secondRequestBodyString = JSON.stringify(secondRequestBody);

      if (verificationId) {
        secondVerificationId = `${verificationId}-synthesis`;
        try {
          const secondNonceResp = await fetch(
            `${runtimeBaseUrl}/api/verification/register-session`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ verificationId: secondVerificationId }),
            }
          );
          if (!secondNonceResp.ok) {
            console.error(
              "[Agent] Failed to register second verification session",
              { status: secondNonceResp.status }
            );
          } else {
            const noncePayload = (await secondNonceResp.json()) as {
              nonce?: string;
            };
            secondNonce = noncePayload?.nonce;
          }
        } catch (error) {
          console.error(
            "[Agent] Error registering second verification session",
            error
          );
        }

        registerVerificationSession(
          secondVerificationId,
          secondNonce,
          null,
          null
        );
      }

      console.log("[Agent] Making second completion with tool results", {
        toolCount: toolMessages.length,
      });

      const secondController = new AbortController();
      const secondTimeout = setTimeout(() => secondController.abort(), 120000);

      const secondNearAIResponse = await fetch(
        "https://cloud-api.near.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.NEAR_AI_CLOUD_API_KEY}`,
            "Content-Type": "application/json",
            ...(secondVerificationId
              ? { "X-Verification-Id": secondVerificationId }
              : {}),
            ...(secondNonce ? { "X-Nonce": secondNonce } : {}),
          },
          body: secondRequestBodyString,
          signal: secondController.signal,
        }
      );
      clearTimeout(secondTimeout);

      if (!secondNearAIResponse.ok) {
        const errorText = await secondNearAIResponse.text();
        console.error("[Agent] Second completion failed:", errorText);
        writeEvent({
          type: EventType.RUN_ERROR,
          message: "Failed to get final response after tool execution",
          code: "SECOND_COMPLETION_FAILED",
          timestamp: Date.now(),
        });
      } else if (secondNearAIResponse.body) {
        const secondReader = secondNearAIResponse.body.getReader();
        const secondDecoder = new TextDecoder();
        let secondBuffer = "";
        let secondMessageStarted = false;
        let secondContent = "";
        const secondMessageId = generateId("msg");
        let secondDone = false;

        while (!secondDone) {
          const { value, done: readerDone } = await secondReader.read();
          if (readerDone) {
            secondDone = true;
          }
          if (value) {
            const chunk = secondDecoder.decode(value, { stream: true });
            secondBuffer += chunk;

            let newlineIndex: number;
            while ((newlineIndex = secondBuffer.indexOf("\n")) !== -1) {
              const line = secondBuffer.slice(0, newlineIndex).trim();
              secondBuffer = secondBuffer.slice(newlineIndex + 1);

              if (!line) continue;
              if (line.startsWith("data:")) {
                const data = line.slice(5).trim();
                if (data === "[DONE]") {
                  secondDone = true;
                  break;
                }
                if (!data) {
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  const choice = parsed.choices?.[0];
                  const delta = choice?.delta;
                  const verification = extractVerificationMetadata(
                    parsed,
                    delta
                  );
                  if (verification?.messageId) {
                    secondRemoteVerificationId = verification.messageId;
                  }

                  const deltaContent = delta?.content;
                  let text = "";
                  if (typeof deltaContent === "string") {
                    text = deltaContent;
                  } else if (Array.isArray(deltaContent)) {
                    text = deltaContent
                      .map((part: any) =>
                        typeof part === "string"
                          ? part
                          : typeof part?.text === "string"
                          ? part.text
                          : ""
                      )
                      .join("");
                  }

                  if (text) {
                    if (!secondMessageStarted) {
                      secondMessageStarted = true;
                      writeEvent({
                        type: EventType.TEXT_MESSAGE_START,
                        messageId: secondMessageId,
                        role: "assistant",
                        timestamp: Date.now(),
                      });
                    }

                    secondContent += text;
                    writeEvent({
                      type: EventType.TEXT_MESSAGE_CONTENT,
                      messageId: secondMessageId,
                      delta: text,
                      timestamp: Date.now(),
                    });
                  }
                } catch (error) {
                  console.error(
                    "[Agent] Failed to parse second completion chunk",
                    error
                  );
                }
              }
            }
          }
        }

        secondDecoder.decode();

        if (secondMessageStarted) {
          writeEvent({
            type: EventType.TEXT_MESSAGE_END,
            messageId: secondMessageId,
            timestamp: Date.now(),
          });
        }
      }
    }

    if (verificationId && remoteVerificationId) {
      const canonicalHashes = await fetchCanonicalHashes(
        remoteVerificationId,
        verificationId,
        AGENT_MODEL
      );

      if (canonicalHashes) {
        updateVerificationHashes(verificationId, {
          requestHash: canonicalHashes.requestHash,
          responseHash: canonicalHashes.responseHash,
        });

        const verificationPayload = {
          messageId: remoteVerificationId,
          verificationId,
          requestHash: canonicalHashes.requestHash,
          responseHash: canonicalHashes.responseHash,
          nonce: verificationNonce ?? null,
          stage: "initial_reasoning",
        };

        console.log(
          "[verification][agent] initial reasoning verified",
          verificationPayload
        );

        writeEvent({
          type: EventType.CUSTOM,
          name: "verification",
          value: verificationPayload,
          timestamp: Date.now(),
        });
      } else {
        console.warn(
          "[verification][agent] Unable to fetch canonical hashes for initial reasoning",
          { verificationId, remoteVerificationId }
        );
      }
    }

    if (secondVerificationId && secondRemoteVerificationId) {
      const secondCanonicalHashes = await fetchCanonicalHashes(
        secondRemoteVerificationId,
        secondVerificationId,
        AGENT_MODEL
      );

      if (secondCanonicalHashes) {
        updateVerificationHashes(secondVerificationId, {
          requestHash: secondCanonicalHashes.requestHash,
          responseHash: secondCanonicalHashes.responseHash,
        });

        const secondVerificationPayload = {
          messageId: secondRemoteVerificationId,
          verificationId: secondVerificationId,
          requestHash: secondCanonicalHashes.requestHash,
          responseHash: secondCanonicalHashes.responseHash,
          nonce: secondNonce ?? null,
          stage: "final_synthesis",
        };

        console.log(
          "[verification][agent] second completion verified",
          secondVerificationPayload
        );

        writeEvent({
          type: EventType.CUSTOM,
          name: "verification",
          value: secondVerificationPayload,
          timestamp: Date.now(),
        });
      } else {
        console.warn(
          "[verification][agent] Unable to fetch canonical hashes for second completion",
          { secondVerificationId, secondRemoteVerificationId }
        );
      }
    }

    // Emit RUN_FINISHED
    writeEvent({
      type: EventType.RUN_FINISHED,
      threadId: thread,
      runId: run,
      timestamp: Date.now(),
    });

    closeStream();
  } catch (error: unknown) {
    console.error("[Agent] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    // Helper to write events (redeclared for catch block scope)
    const writeEvent = (event: AGUIEvent) => {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      if (stream) {
        stream.write(payload);
      } else {
        res.write(payload);
      }
    };

    if (error instanceof Error && error.name === "AbortError") {
      writeEvent({
        type: EventType.RUN_ERROR,
        message: "Upstream request timed out",
        code: "TIMEOUT",
        timestamp: Date.now(),
      });
      writeEvent({
        type: EventType.RUN_FINISHED,
        threadId: thread,
        runId: run,
        timestamp: Date.now(),
      });
      closeStream();
      return;
    }

    const errorEvent: AGUIEvent = {
      type: EventType.RUN_ERROR,
      message,
      code: "AGENT_ERROR",
      timestamp: Date.now(),
    };
    writeEvent(errorEvent);
    closeStream();
  }
}
