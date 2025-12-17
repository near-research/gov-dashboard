import { expect, test } from "@playwright/test";
import {
  registerPlaywrightMocks,
  registerMockVerificationSessionsForEvents,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import type { AGUIEvent } from "@/types/agui-events";
import { EventType } from "@/types/agui-events";

const { describe: describeSpec } = createPlaywrightGuard("chat-agent-pipeline.spec.ts");

const createSsePayload = (events: AGUIEvent[]) =>
  `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;

const buildProposalList = (suffix: string) => ({
  type: "proposal_list",
  description: `Structured proposals and context for ${suffix}.`,
  topics: [
    {
      id: 1000 + suffix.charCodeAt(0),
      title: `NEAR Proposal ${suffix} Alpha`,
      slug: `proposal-${suffix.toLowerCase()}-alpha`,
      excerpt: `Mock excerpt describing ${suffix} goals.`,
      created_at: new Date().toISOString(),
      username: "alice",
      author: "alice",
      topic_id: 1000 + suffix.charCodeAt(0),
      topic_slug: `proposal-${suffix.toLowerCase()}-alpha`,
      reply_count: 3,
      views: 120,
      last_posted_at: new Date().toISOString(),
      url: `https://gov.near.org/t/proposal-${suffix.toLowerCase()}-alpha/${1000 + suffix.charCodeAt(0)}`,
    },
  ],
});

const buildDiscourseResult = (suffix: string) => ({
  topicTitle: `Discourse topic ${suffix}`,
  summary: `Discourse summary for ${suffix} from the governance forum.`,
  url: `https://gov.near.org/t/discourse-${suffix.toLowerCase()}/1234`,
});

const buildDocResult = (suffix: string) => ({
  docKey: "overview",
  title: `House of Stake overview (${suffix})`,
  snippet: `Doc snippet for ${suffix}`,
  url: `https://houseofstake.org/docs/overview`,
});

type AgentStreamOptions = {
  prefix: string;
  intro: string;
  finalMessage: string;
};

const buildAgentStream = ({
  prefix,
  intro,
  finalMessage,
}: AgentStreamOptions): AGUIEvent[] => {
  const now = Date.now();
  const messageId = `assistant-${prefix}-${now}`;
  const threadId = `thread-${prefix}-${now}`;
  const runId = `run-${prefix}-${now}`;
  const proposalToolId = `tool-${prefix}-proposals`;
  const discourseToolId = `tool-${prefix}-discourse`;
  const docToolId = `tool-${prefix}-doc`;

  return [
    {
      type: EventType.RUN_STARTED,
      threadId,
      runId,
      timestamp: now,
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
      timestamp: now + 1,
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: intro,
      timestamp: now + 2,
    },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: proposalToolId,
      toolCallName: "search_discourse",
      parentMessageId: messageId,
      timestamp: now + 3,
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: proposalToolId,
      delta: JSON.stringify({ query: `${prefix} proposals` }),
      timestamp: now + 4,
    },
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId,
      toolCallId: proposalToolId,
      toolCallName: "search_discourse",
      role: "tool",
      content: JSON.stringify(buildProposalList(prefix)),
      timestamp: now + 5,
    },
    {
      type: EventType.TOOL_CALL_END,
      toolCallId: proposalToolId,
      timestamp: now + 6,
    },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: discourseToolId,
      toolCallName: "get_discourse_topic",
      parentMessageId: messageId,
      timestamp: now + 7,
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: discourseToolId,
      delta: JSON.stringify({ topic_id: 5000 + prefix.charCodeAt(0) }),
      timestamp: now + 8,
    },
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId,
      toolCallId: discourseToolId,
      toolCallName: "get_discourse_topic",
      role: "tool",
      content: JSON.stringify(buildDiscourseResult(prefix)),
      timestamp: now + 9,
    },
    {
      type: EventType.TOOL_CALL_END,
      toolCallId: discourseToolId,
      timestamp: now + 10,
    },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: docToolId,
      toolCallName: "get_doc",
      parentMessageId: messageId,
      timestamp: now + 11,
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: docToolId,
      delta: JSON.stringify({ doc_key: "overview" }),
      timestamp: now + 12,
    },
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId,
      toolCallId: docToolId,
      toolCallName: "get_doc",
      role: "tool",
      content: JSON.stringify(buildDocResult(prefix)),
      timestamp: now + 13,
    },
    {
      type: EventType.TOOL_CALL_END,
      toolCallId: docToolId,
      timestamp: now + 14,
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: finalMessage,
      timestamp: now + 15,
    },
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
      timestamp: now + 16,
    },
    {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      timestamp: now + 17,
    },
    {
      type: EventType.CUSTOM,
      name: "verification",
      value: {
        stage: "final_synthesis",
        verificationId: `${messageId}-proof`,
        requestHash: `req-${prefix}`,
        responseHash: `res-${prefix}`,
        nonce: `nonce-${prefix}`,
        messageId,
      },
      proof: {
        verificationId: `${messageId}-proof`,
        nonce: `nonce-${prefix}`,
        requestHash: `req-${prefix}`,
        responseHash: `res-${prefix}`,
        stage: "final_synthesis",
      },
      timestamp: now + 18,
    },
  ];
};

describeSpec("Chat-to-agent pipeline", () => {
  test("streams agent response and re-enables input", async ({ page }) => {
    registerPlaywrightMocks(page, {
      skipChatCompletionsStream: true,
      skipAgentStream: true,
    });

    const streamEvents = buildAgentStream({
      prefix: "happy",
      intro: "Processing your request.",
      finalMessage: "Here is your governance summary.",
    });

    await page.route("**/api/agent**", async (route) => {
      registerMockVerificationSessionsForEvents(streamEvents);
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body: createSsePayload(streamEvents),
      });
    });

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    const input = page.getByTestId("chat-input");
    await input.fill("Summarize governance activity");

    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes("/api/agent") && resp.status() === 200),
      page.keyboard.press("Enter"),
    ]);

    await response.finished();

    await expect(page.getByText("Here is your governance summary.")).toBeVisible({
      timeout: 10000,
    });
    await expect(input).toBeEnabled();
  });

  test("shows a rate limit error when the agent API returns 429", async ({ page }) => {
    registerPlaywrightMocks(page, {
      skipChatCompletionsStream: true,
      skipAgentStream: true,
    });

    await page.route("**/api/agent**", async (route) => {
      await route.fulfill({
        status: 429,
        headers: {
          "Content-Type": "text/plain",
        },
        body: "Rate limit exceeded",
      });
    });

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    const input = page.getByTestId("chat-input");
    await input.fill("Trigger rate limit");

    await Promise.all([
      page.waitForResponse((resp) => resp.url().includes("/api/agent") && resp.status() === 429),
      page.keyboard.press("Enter"),
    ]);

    await expect(
      page.getByText("Agent request failed: 429").first()
    ).toBeVisible();
  });
});
