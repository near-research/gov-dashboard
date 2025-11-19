/**
 * NEAR AI Cloud Agent API Route using AG-UI Protocol
 */

import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { requestEvaluation } from "@/server/screening";
import {
  EventType,
  type AGUIEvent,
  type CompletionMessage,
  type MessageRole,
  type ProposalAgentState,
} from "@/types/agui-events";
import { extractVerificationMetadata } from "@/utils/verification";
import type { Evaluation } from "@/types/evaluation";
import { AGENT_MODEL, buildProposalAgentRequest } from "@/utils/agent-tools";
import {
  registerVerificationSession,
  updateVerificationHashes,
} from "@/server/verificationSessions";
import { servicesConfig } from "@/config/services";
import type { DiscourseSearchResponse } from "@/types/discourse";

interface AgentRequestBody {
  messages: Array<{ role: MessageRole; content: string }>;
  threadId?: string;
  runId?: string;
  state?: Partial<ProposalAgentState>;
  verificationId?: string;
  verificationNonce?: string;
}

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || process.env.SITE_URL || "";

const PROPOSALS_CATEGORY_ID = Number(
  process.env.DISCOURSE_PROPOSALS_CATEGORY_ID || 168
);

type ToolCallArgs = {
  title?: string;
  content?: string;
  query?: string;
  limit?: number;
  topic_id?: string;
  post_id?: string;
};

type DiscourseSearchResult = Awaited<ReturnType<typeof searchDiscourse>>;

// Generate unique IDs
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

const stripHtml = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function searchDiscourse(
  query: string,
  limit = 5
): Promise<{
  query: string;
  results: Array<{
    topicId?: number;
    postId: number;
    author: string;
    excerpt: string;
    url: string;
    createdAt: string;
  }>;
  totalMatches: number;
}> {
  if (!query?.trim()) {
    throw new Error("Search query is required");
  }

  const searchUrl = new URL(`${servicesConfig.discourseBaseUrl}/search.json`);
  searchUrl.searchParams.set("q", query.trim());
  searchUrl.searchParams.set("search_context[type]", "category");
  searchUrl.searchParams.set(
    "search_context[id]",
    PROPOSALS_CATEGORY_ID.toString()
  );

  const response = await fetch(searchUrl.toString(), {
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Discourse API error: ${response.status}`);
  }

  const data = (await response.json()) as DiscourseSearchResponse;
  const posts = Array.isArray(data.posts) ? data.posts.slice(0, limit) : [];
  const formatted = posts.map((post) => ({
    topicId: post.topic_id,
    postId: post.id,
    author: post.username,
    excerpt: stripHtml(post.cooked || "").slice(0, 400),
    url: `${servicesConfig.discourseBaseUrl}/p/${post.id}`,
    createdAt: post.created_at,
  }));

  return {
    query,
    results: formatted,
    totalMatches: data.grouped_search_result?.post_ids?.length || posts.length,
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

  // Extract IDs early so they're available in catch block
  const body = req.body as AgentRequestBody;
  const thread = body.threadId || generateId("thread");
  const run = body.runId || generateId("run");
  const runtimeBaseUrl =
    APP_BASE_URL ||
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : "http://localhost:3000");
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

    const { requestBody, toolChoice } = buildProposalAgentRequest({
      messages,
      state,
      model: AGENT_MODEL,
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

    const trailingChunk = decoder.decode();
    if (trailingChunk) {
      rawUpstreamResponse += trailingChunk;
    }

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

      return res.end();
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      console.log(
        "[Agent] Tool calls detected, executing locally and making second completion",
        { count: message.tool_calls.length }
      );

      const toolMessages: Array<{
        role: "tool";
        content: string;
        tool_call_id: string;
      }> = [];

      for (const toolCall of message.tool_calls) {
        const toolCallId = toolCall.id;
        const toolName = toolCall.function.name;
        const args = JSON.parse(
          toolCall.function.arguments || "{}"
        ) as ToolCallArgs;

        let result:
          | Evaluation
          | { title: string; content: string; status: string }
          | DiscourseSearchResult
          | Record<string, unknown>
          | null = null;

        if (toolName === "screen_proposal" && args.title && args.content) {
          const screeningResult = await requestEvaluation(
            args.title,
            args.content
          );
          result = screeningResult.evaluation;

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
          });
        } else if (
          toolName === "write_proposal" &&
          args.title &&
          args.content
        ) {
          result = {
            title: args.title,
            content: args.content,
            status: "pending_confirmation",
          };

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
        } else if (toolName === "search_discourse" && args.query) {
          const limit =
            typeof args.limit === "number"
              ? args.limit
              : Number(args.limit ?? 5);
          const boundedLimit =
            Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10) : 5;
          try {
            result = await searchDiscourse(args.query, boundedLimit);
          } catch (searchError) {
            result = {
              error:
                searchError instanceof Error
                  ? searchError.message
                  : "Failed to search Discourse",
            };
          }
        } else if (toolName === "get_discourse_topic" && args.topic_id) {
          try {
            const topicResponse = await fetch(
              `${servicesConfig.discourseBaseUrl}/t/${args.topic_id}.json`
            );
            if (!topicResponse.ok) {
              throw new Error(`Failed to fetch topic: ${topicResponse.status}`);
            }
            const topic = await topicResponse.json();
            const posts = topic.post_stream?.posts || [];
            result = {
              id: topic.id,
              title: topic.title,
              slug: topic.slug,
              posts_count: topic.posts_count,
              views: topic.views,
              like_count: topic.like_count,
              participant_count: topic.participant_count,
              created_at: topic.post_stream?.posts?.[0]?.created_at,
              last_posted_at: topic.last_posted_at,
              url: `${servicesConfig.discourseBaseUrl}/t/${topic.slug}/${topic.id}`,
              posts: posts.slice(0, 20).map((post: any) => ({
                id: post.id,
                post_number: post.post_number,
                username: post.username,
                content: stripHtml(post.cooked || "").slice(0, 800),
                created_at: post.created_at,
                like_count:
                  post.actions_summary?.find((a: any) => a.id === 2)?.count ||
                  0,
                reply_to_post_number: post.reply_to_post_number,
                reply_to_user: post.reply_to_user?.username,
                url: `${servicesConfig.discourseBaseUrl}/t/${topic.slug}/${topic.id}/${post.post_number}`,
              })),
            };
          } catch (topicError) {
            result = {
              error:
                topicError instanceof Error
                  ? topicError.message
                  : "Failed to fetch topic",
            };
          }
        } else if (toolName === "get_latest_topics") {
          const limit =
            typeof args.limit === "number" ? Math.min(args.limit, 30) : 10;
          try {
            const latestResponse = await fetch(
              `${runtimeBaseUrl}/api/discourse/latest?per_page=${limit}`
            );
            if (!latestResponse.ok) {
              throw new Error(
                `Failed to fetch latest topics: ${latestResponse.status}`
              );
            }
            const data = await latestResponse.json();
            result = {
              topics:
                data.latest_posts?.slice(0, limit).map((topic: any) => ({
                  id: topic.topic_id,
                  title: topic.title,
                  slug: topic.topic_slug,
                  excerpt: topic.excerpt,
                  author: topic.username,
                  posts_count: topic.posts_count,
                  reply_count: topic.reply_count,
                  views: topic.views,
                  like_count: topic.like_count,
                  created_at: topic.created_at,
                  last_posted_at: topic.last_posted_at,
                  url: `${servicesConfig.discourseBaseUrl}/t/${topic.topic_slug}/${topic.topic_id}`,
                })) || [],
              total_count: data.latest_posts?.length || 0,
            };
          } catch (latestError) {
            result = {
              error:
                latestError instanceof Error
                  ? latestError.message
                  : "Failed to fetch latest topics",
            };
          }
        } else if (toolName === "summarize_discussion" && args.topic_id) {
          try {
            const summaryResponse = await fetch(
              `${runtimeBaseUrl}/api/discourse/topics/${args.topic_id}/summarize`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              }
            );
            if (!summaryResponse.ok) {
              throw new Error(
                `Failed to summarize discussion: ${summaryResponse.status}`
              );
            }
            const summaryData = await summaryResponse.json();
            result = {
              topic_id: args.topic_id,
              title: summaryData.title,
              summary: summaryData.summary,
              reply_count: summaryData.replyCount,
              engagement: summaryData.engagement,
              url: `${servicesConfig.discourseBaseUrl}/t/${args.topic_id}`,
            };
          } catch (summaryError) {
            result = {
              error:
                summaryError instanceof Error
                  ? summaryError.message
                  : "Failed to summarize discussion",
            };
          }
        } else if (toolName === "summarize_reply" && args.post_id) {
          try {
            const replyResponse = await fetch(
              `${runtimeBaseUrl}/api/discourse/replies/${args.post_id}/summarize`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              }
            );
            if (!replyResponse.ok) {
              throw new Error(
                `Failed to summarize reply: ${replyResponse.status}`
              );
            }
            const replyData = await replyResponse.json();
            result = {
              post_id: args.post_id,
              author: replyData.author,
              post_number: replyData.postNumber,
              summary: replyData.summary,
              like_count: replyData.likeCount,
              reply_to: replyData.replyTo,
            };
          } catch (replyError) {
            result = {
              error:
                replyError instanceof Error
                  ? replyError.message
                  : "Failed to summarize reply",
            };
          }
        }

        writeEvent({
          type: EventType.TOOL_CALL_RESULT,
          messageId: generateId("tool_result"),
          toolCallId,
          content: JSON.stringify(result, null, 2),
          role: "tool",
          timestamp: Date.now(),
        });

        toolMessages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: toolCallId,
        });
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
        let secondRawResponse = "";
        let secondMessageStarted = false;
        let secondContent = "";
        const secondMessageId = generateId("msg");

        while (true) {
          const { value, done: secondDone } = await secondReader.read();
          if (value) {
            const chunk = secondDecoder.decode(value, { stream: true });
            secondRawResponse += chunk;
            secondBuffer += chunk;

            let newlineIndex: number;
            while ((newlineIndex = secondBuffer.indexOf("\n")) !== -1) {
              const line = secondBuffer.slice(0, newlineIndex).trim();
              secondBuffer = secondBuffer.slice(newlineIndex + 1);

              if (!line) continue;
              if (line.startsWith("data:")) {
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") {
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  const choice = parsed.choices?.[0];
                  const delta = choice?.delta;

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

          if (secondDone) break;
        }

        const secondTrailingChunk = secondDecoder.decode();
        if (secondTrailingChunk) {
          secondRawResponse += secondTrailingChunk;
        }

        if (secondMessageStarted) {
          writeEvent({
            type: EventType.TEXT_MESSAGE_END,
            messageId: secondMessageId,
            timestamp: Date.now(),
          });
        }
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

      console.log(
        "[verification][agent] response complete",
        verificationPayload
      );

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
