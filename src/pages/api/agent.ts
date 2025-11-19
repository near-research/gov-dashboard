/**
 * NEAR AI Cloud Agent API Route using AG-UI Protocol
 */

import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  requestEvaluation,
  type EvaluationRequestResult,
} from "@/server/screening";
import {
  EventType,
  type AGUIEvent,
  type CompletionMessage,
  type MessageRole,
  type ProposalAgentState,
} from "@/types/agui-events";
import type { VerificationMetadata } from "@/types/agui-events";
import { extractVerificationMetadata } from "@/utils/verification";
import type { Evaluation } from "@/types/evaluation";
import {
  buildProposalAgentRequest,
  PROPOSAL_AGENT_MODEL,
} from "@/utils/proposal-agent";
import {
  registerVerificationSession,
  updateVerificationHashes,
} from "@/server/verificationSessions";

interface AgentRequestBody {
  messages: Array<{ role: MessageRole; content: string }>;
  threadId?: string;
  runId?: string;
  state?: Partial<ProposalAgentState>;
  verificationId?: string;
  verificationNonce?: string;
}

// Screen proposal using shared evaluation helper
async function screenProposal(
  title: string,
  content: string
): Promise<EvaluationRequestResult> {
  return requestEvaluation(title, content);
}

// Generate unique IDs
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Extract IDs early so they're available in catch block
  const body = req.body as AgentRequestBody;
  const thread = body.threadId || generateId("thread");
  const run = body.runId || generateId("run");

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

    // Normalize state and build upstream request body
    const { requestBody, toolChoice } = buildProposalAgentRequest({
      messages,
      state,
      model: PROPOSAL_AGENT_MODEL,
    });
    const requestBodyString = JSON.stringify(requestBody);
    const requestHash = createHash("sha256")
      .update(requestBodyString)
      .digest("hex");

    if (verificationId) {
      registerVerificationSession(
        verificationId,
        verificationNonce,
        requestHash,
        null
      );
    }

    console.log("[Agent] Tool choice:", toolChoice);
    if (verificationId) {
      console.log("[verification][agent] request prepared", {
        verificationId,
        requestHash,
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

    // Helper to write events
    const writeEvent = (event: AGUIEvent) => {
      const data = JSON.stringify(event);
      res.write(`data: ${data}\n\n`);
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
    let rawUpstreamResponse = "";

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

    let latestVerification: VerificationMetadata | undefined;
    let remoteVerificationId: string | undefined;

    const handleContentDelta = (
      content: any,
      verification?: VerificationMetadata
    ) => {
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
        verification: verification ?? latestVerification,
      });
    };

    const handleToolCallDelta = (
      toolCallDelta: any,
      verification?: VerificationMetadata
    ) => {
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
            verification: verification ?? latestVerification,
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
            verification: verification ?? latestVerification,
          });
        }
      }
    };

    let finishReason: string | null = null;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        rawUpstreamResponse += chunk;
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

              if (verification) {
                latestVerification = verification;
                if (verification.messageId) {
                  remoteVerificationId = verification.messageId;
                }
              }

              if (delta?.content) {
                handleContentDelta(delta.content, verification);
              }

              if (Array.isArray(delta?.tool_calls)) {
                delta.tool_calls.forEach((toolDelta: any) =>
                  handleToolCallDelta(toolDelta, verification)
                );
              }

              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }
            } catch (parseError) {
              console.error("[Agent] Failed to parse streaming chunk", parseError);
            }
          }
        }
      }

      if (readerDone) {
        break;
      }
    }

    const trailingChunk = decoder.decode();
    if (trailingChunk) {
      rawUpstreamResponse += trailingChunk;
    }

    if (assistantMessageStarted) {
      writeEvent({
        type: EventType.TEXT_MESSAGE_END,
        messageId: assistantMessageId,
        timestamp: Date.now(),
        verification: latestVerification,
      });
    }

    toolCallStates.forEach((state) => {
      if (state.started) {
        writeEvent({
          type: EventType.TOOL_CALL_END,
          toolCallId: state.id,
          timestamp: Date.now(),
          verification: latestVerification,
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

      return res.end();
    }

    // Handle tool calls after streaming completes
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const toolCallId = toolCall.id;
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || "{}") as {
          title?: string;
          content?: string;
        };

        // Execute tool
        let result:
          | Evaluation
          | { title: string; content: string; status: string }
          | null = null;

        if (toolName === "screen_proposal" && args.title && args.content) {
          const screeningResult = await screenProposal(args.title, args.content);
          result = screeningResult.evaluation;

          if (screeningResult.verification) {
            latestVerification = screeningResult.verification;
          }

          console.log(
            `[Agent] Screening complete - Quality: ${(
              screeningResult.evaluation.qualityScore * 100
            ).toFixed(0)}%, Attention: ${(
              screeningResult.evaluation.attentionScore * 100
            ).toFixed(0)}%`
          );

          writeEvent({
            type: EventType.STATE_DELTA,
            delta: [
              {
                op: "replace",
                path: "/evaluation",
                value: screeningResult.evaluation,
              },
            ],
            timestamp: Date.now(),
            verification: screeningResult.verification ?? latestVerification,
          });
        } else if (toolName === "write_proposal" && args.title && args.content) {
          result = {
            title: args.title,
            content: args.content,
            status: "pending_confirmation",
          };

          // Send state delta for proposal updates
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

        // Emit tool result
        writeEvent({
          type: EventType.TOOL_CALL_RESULT,
          messageId: generateId("tool_result"),
          toolCallId,
          content: JSON.stringify(result, null, 2),
          role: "tool",
          timestamp: Date.now(),
          verification: latestVerification,
        });
      }

      if (toolStepStarted) {
        writeEvent({
          type: EventType.STEP_FINISHED,
          stepName: "execute_tools",
          timestamp: Date.now(),
        });
      }
    }

    if (verificationId) {
      const responseHash = createHash("sha256")
        .update(rawUpstreamResponse)
        .digest("hex");

      updateVerificationHashes(verificationId, {
        requestHash,
        responseHash,
      });

      const verificationPayload = {
        messageId: remoteVerificationId || verificationId,
        verificationId,
        requestHash,
        responseHash,
        nonce: verificationNonce ?? null,
      };

      console.log("[verification][agent] response complete", verificationPayload);

      writeEvent({
        type: EventType.CUSTOM,
        name: "verification",
        value: verificationPayload,
        timestamp: Date.now(),
      });
    }

    // Emit RUN_FINISHED
    writeEvent({
      type: EventType.RUN_FINISHED,
      threadId: thread,
      runId: run,
      timestamp: Date.now(),
    });

    res.end();
  } catch (error: unknown) {
    console.error("[Agent] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    // Helper to write events (redeclared for catch block scope)
    const writeEvent = (event: AGUIEvent) => {
      const data = JSON.stringify(event);
      res.write(`data: ${data}\n\n`);
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
      return res.end();
    }

    const errorEvent: AGUIEvent = {
      type: EventType.RUN_ERROR,
      message,
      code: "AGENT_ERROR",
      timestamp: Date.now(),
    };
    res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
    res.end();
  }
}
