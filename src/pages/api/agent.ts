/**
 * NEAR AI Cloud Agent API Route using AG-UI Protocol
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { requestEvaluation } from "@/server/screening";
import {
  EventType,
  type AGUIEvent,
  type CompletionMessage,
  type MessageRole,
  type ProposalAgentState,
  type ToolChoice,
} from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";

interface AgentRequestBody {
  messages: Array<{ role: MessageRole; content: string }>;
  threadId?: string;
  runId?: string;
  state?: Partial<ProposalAgentState>;
}

// Tool definitions
const TOOLS = [
  {
    type: "function",
    function: {
      name: "write_proposal",
      description: [
        "Write or edit a NEAR governance proposal.",
        "Use markdown formatting. Include sections: Objectives, Budget, Timeline, KPIs.",
        "Write the FULL proposal, even when changing only a few words.",
        "Make edits minimal and targeted to address specific screening criteria.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The proposal title",
          },
          content: {
            type: "string",
            description: "The full proposal content in markdown",
          },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screen_proposal",
      description:
        "Screen a proposal against NEAR governance criteria. Returns evaluation with pass/fail for quality criteria and attention scores.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The proposal title",
          },
          content: {
            type: "string",
            description: "The proposal content",
          },
        },
        required: ["title", "content"],
      },
    },
  },
];

const normalizeState = (
  state: Partial<ProposalAgentState> | undefined
): ProposalAgentState => ({
  title: state?.title ?? "",
  content: state?.content ?? "",
  evaluation: state?.evaluation ?? null,
});

// System prompt builder
function getSystemPrompt(currentState: ProposalAgentState) {
  return `You are a NEAR governance proposal assistant. You help users write high-quality proposals that meet NEAR's criteria.

**Current Proposal State:**
Title: ${currentState.title || "(empty)"}
Content: ${currentState.content || "(empty)"}
${
  currentState.evaluation
    ? `Quality Score: ${(currentState.evaluation.qualityScore * 100).toFixed(
        0
      )}%
Attention Score: ${(currentState.evaluation.attentionScore * 100).toFixed(0)}%`
    : ""
}

**CRITICAL INSTRUCTIONS:**
- When the user asks you to write, generate, create, or add ANY content to the proposal, you MUST use the write_proposal tool
- When asked to "generate title", "add title", "write content" → use write_proposal tool immediately
- DO NOT just chat about what you would write - actually write it using the tool
- If title is empty and user asks for content, generate a title too
- If content is empty, generate full proposal content

**NEAR Proposal Criteria:**

**Quality Criteria (must all pass):**
1. **Complete**: Objectives, budget breakdown, timeline, measurable KPIs
2. **Legible**: Clear, well-structured, error-free, professionally formatted
3. **Consistent**: No contradictions in budget, timeline, or scope
4. **Compliant**: Follows NEAR governance rules and community standards
5. **Justified**: Strong rationale for funding amount and approach
6. **Measurable**: Clear success metrics and evaluation criteria

**Attention Scores (informational):**
- **Relevant**: How aligned is this with NEAR ecosystem priorities? (high/medium/low)
- **Material**: What's the potential impact and significance? (high/medium/low)

**Quality Score**: Percentage of quality criteria passed (need 100% to pass)
**Attention Score**: Combined relevance and materiality score (0.0 to 1.0)

**Your Tasks:**
- To screen: use screen_proposal tool
- To write/generate/create/add content: use write_proposal tool IMMEDIATELY
- Base edits on screening results - fix specific failing criteria
- Keep changes minimal and targeted
- After calling write_proposal, just briefly explain what you did (1-2 sentences)

${
  currentState.evaluation
    ? `
**Last Screening Results:**
Overall Pass: ${currentState.evaluation.overallPass ? "YES" : "NO"}
Quality Score: ${(currentState.evaluation.qualityScore * 100).toFixed(0)}% (${
        currentState.evaluation.qualityScore === 1.0
          ? "Perfect!"
          : "Needs improvement"
      })
Attention Score: ${(currentState.evaluation.attentionScore * 100).toFixed(
        0
      )}% (Relevant: ${
        currentState.evaluation.relevant?.score || "unknown"
      }, Material: ${currentState.evaluation.material?.score || "unknown"})

Failed Quality Criteria: ${
        Object.entries(currentState.evaluation)
          .filter(
            ([key, val]: [string, any]) =>
              [
                "complete",
                "legible",
                "consistent",
                "compliant",
                "justified",
                "measurable",
              ].includes(key) &&
              typeof val === "object" &&
              val.pass === false
          )
          .map(([key, val]: [string, any]) => `${key} (${val.reason})`)
          .join("; ") || "None - all quality criteria passed!"
      }
`
    : ""
}`;
}

// Screen proposal using shared evaluation helper
async function screenProposal(title: string, content: string) {
  return requestEvaluation(title, content);
}

// Generate unique IDs
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper to simulate streaming delays
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body as AgentRequestBody;
    const { messages, threadId, runId: clientRunId, state } = body;

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

    // Generate IDs
    const thread = threadId || generateId("thread");
    const run = clientRunId || generateId("run");

    // Current state from frontend
    const currentState = normalizeState(state);

    // Build conversation
    const conversationMessages = [
      {
        role: "system",
        content: getSystemPrompt(currentState),
      },
      ...messages,
    ];

    // Detect user intent
    const lastUserMessage =
      messages[messages.length - 1]?.content?.toLowerCase() || "";
    const isWriteIntent =
      lastUserMessage.includes("write") ||
      lastUserMessage.includes("generate") ||
      lastUserMessage.includes("create") ||
      lastUserMessage.includes("add") ||
      lastUserMessage.includes("improve") ||
      lastUserMessage.includes("edit");

    const isScreenIntent =
      lastUserMessage.includes("screen") ||
      lastUserMessage.includes("evaluate") ||
      lastUserMessage.includes("check") ||
      lastUserMessage.includes("review");

    // Smart tool choice
    let toolChoice: ToolChoice = "auto";

    if (isWriteIntent && !isScreenIntent) {
      toolChoice = {
        type: "function",
        function: { name: "write_proposal" },
      };
    } else if (isScreenIntent && !isWriteIntent) {
      toolChoice = {
        type: "function",
        function: { name: "screen_proposal" },
      };
    }

    console.log("[Agent] Tool choice:", toolChoice);

    // Direct fetch to NEAR AI Cloud (NON-STREAMING)
    const nearAIResponse = await fetch(
      "https://cloud-api.near.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEAR_AI_CLOUD_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: conversationMessages,
          tools: TOOLS,
          tool_choice: toolChoice,
          stream: false,
        }),
      }
    );

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

    // Parse non-streaming response
    const data = (await nearAIResponse.json()) as {
      choices?: Array<{ message?: CompletionMessage }>;
    };
    const message = data.choices?.[0]?.message;

    if (!message) {
      writeEvent({
        type: EventType.RUN_ERROR,
        message: "No message in response",
        code: "NO_MESSAGE",
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

    // Handle text content
    if (message.content) {
      const messageId = generateId("msg");

      writeEvent({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
        timestamp: Date.now(),
      });

      // Simulate streaming by sending content in chunks
      const content = message.content;
      const chunkSize = 50;
      for (let i = 0; i < content.length; i += chunkSize) {
        writeEvent({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: content.slice(i, i + chunkSize),
          timestamp: Date.now(),
        });
        await sleep(15); // Small delay for UX
      }

      writeEvent({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
        timestamp: Date.now(),
      });
    }

    // Handle tool calls
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      writeEvent({
        type: EventType.STEP_STARTED,
        stepName: "execute_tools",
        timestamp: Date.now(),
      });

      for (const toolCall of message.tool_calls) {
        const toolCallId = toolCall.id;
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments) as {
          title: string;
          content: string;
        };

        // Emit tool call start
        writeEvent({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: toolName,
          parentMessageId: null,
          timestamp: Date.now(),
        });

        // Simulate streaming args
        const argsStr = JSON.stringify(args);
        const chunkSize = 40;
        for (let i = 0; i < argsStr.length; i += chunkSize) {
          writeEvent({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: argsStr.slice(i, i + chunkSize),
            timestamp: Date.now(),
          });
          await sleep(10);
        }

        writeEvent({
          type: EventType.TOOL_CALL_END,
          toolCallId,
          timestamp: Date.now(),
        });

        // Execute tool
        let result: Evaluation | { title: string; content: string; status: string } | null = null;

        if (toolName === "screen_proposal") {
          result = await screenProposal(args.title, args.content);

          console.log(
            `[Agent] Screening complete - Quality: ${(
              result.qualityScore * 100
            ).toFixed(0)}%, Attention: ${(result.attentionScore * 100).toFixed(
              0
            )}%`
          );

          writeEvent({
            type: EventType.STATE_DELTA,
            delta: [
              {
                op: "replace",
                path: "/evaluation",
                value: result,
              },
            ],
            timestamp: Date.now(),
          });
        } else if (toolName === "write_proposal") {
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
        });
      }

      writeEvent({
        type: EventType.STEP_FINISHED,
        stepName: "execute_tools",
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
    const message =
      error instanceof Error ? error.message : "Unknown error";
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
