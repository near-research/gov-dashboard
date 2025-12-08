import { expect, test, type Page, type Route } from "@playwright/test";
import {
  registerMockVerificationSessionsForEvents,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import type { AGUIEvent } from "@/types/agui-events";
import { EventType } from "@/types/agui-events";

const { describe: describeSpec } = createPlaywrightGuard("near-ai-assistant.spec.ts");

type ProofMeta = {
  verificationId: string;
  nonce: string;
  requestHash: string;
  responseHash: string;
  stage: "initial_reasoning" | "final_synthesis";
  messageId: string;
};

type ChatMockEvent = AGUIEvent & { proof?: ProofMeta };
type ChatMockResponse =
  | { type: "stream"; events: ChatMockEvent[] }
  | { type: "error"; status: number; body: Record<string, unknown> };

const createSsePayload = (events: ChatMockEvent[]) =>
  `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;

const buildProposalList = (suffix: string) => ({
  type: "proposal_list",
  description: `Structured proposals for the ${suffix} flow.`,
  topics: [
    {
      id: 1000 + suffix.charCodeAt(0),
      title: `NEAR Proposal ${suffix} Alpha`,
      slug: `proposal-${suffix}-alpha`,
      excerpt: "Mock excerpt with key goals and measurable KPIs.",
      created_at: new Date().toISOString(),
      username: "alice",
      author: "alice",
      topic_id: 1000 + suffix.charCodeAt(0),
      topic_slug: `proposal-${suffix}-alpha`,
      reply_count: 3,
      views: 120,
      last_posted_at: new Date().toISOString(),
      url: `https://gov.near.org/t/proposal-${suffix}-alpha/${1000 + suffix.charCodeAt(0)}`,
    },
    {
      id: 2000 + suffix.charCodeAt(0),
      title: `NEAR Proposal ${suffix} Beta`,
      slug: `proposal-${suffix}-beta`,
      excerpt: "Additional context on community feedback and impact metrics.",
      created_at: new Date().toISOString(),
      username: "bob",
      author: "bob",
      topic_id: 2000 + suffix.charCodeAt(0),
      topic_slug: `proposal-${suffix}-beta`,
      reply_count: 5,
      views: 210,
      last_posted_at: new Date().toISOString(),
      url: `https://gov.near.org/t/proposal-${suffix}-beta/${2000 + suffix.charCodeAt(0)}`,
    },
  ],
});

const buildSuccessStream = ({
  prefix,
  intro,
  finalMessage,
}: {
  prefix: string;
  intro: string;
  finalMessage: string;
}): ChatMockEvent[] => {
  const now = Date.now();
  const messageId = `assistant-${prefix}-${now}`;
  const toolCallId = `tool-call-${prefix}-${now}`;
  const threadId = `thread-${prefix}`;
  const runId = `run-${prefix}-${now}`;
  const verificationId = `${messageId}-proof`;
  const proofPayload: ProofMeta = {
    verificationId,
    nonce: `nonce-${prefix}`,
    requestHash: `req-${prefix}`,
    responseHash: `res-${prefix}`,
    stage: "final_synthesis",
    messageId,
  };

  const events: ChatMockEvent[] = [
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
      toolCallId,
      toolCallName: "search_discourse",
      parentMessageId: messageId,
      timestamp: now + 3,
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify({ query: "recent governance proposals" }),
      timestamp: now + 4,
    },
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId,
      toolCallId,
      toolCallName: "search_discourse",
      role: "tool",
      content: JSON.stringify(buildProposalList(prefix)),
      timestamp: now + 5,
    },
    {
      type: EventType.TOOL_CALL_END,
      toolCallId,
      timestamp: now + 6,
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: finalMessage,
      timestamp: now + 7,
    },
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
      timestamp: now + 8,
    },
    {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      timestamp: now + 9,
    },
    {
      type: EventType.CUSTOM,
      name: "verification",
      value: {
        stage: proofPayload.stage,
        verificationId: proofPayload.verificationId,
        nonce: proofPayload.nonce,
        requestHash: proofPayload.requestHash,
        responseHash: proofPayload.responseHash,
        messageId: proofPayload.messageId,
      },
      proof: proofPayload,
      timestamp: now + 10,
    } as ChatMockEvent,
  ];

  return events;
};

const ensurePlausibleSpy = async (page: Page) => {
  await page.addInitScript(() => {
    (window as typeof window & { plausibleEvents?: Array<unknown>; plausible?: (...args: any[]) => void }).plausibleEvents =
      [];
    const original = (window as any).plausible ?? (() => undefined);
    (window as any).plausible = (event: string, opts?: { props?: Record<string, unknown> }) => {
      (window as any).plausibleEvents.push({ event, props: opts?.props });
      return original(event, opts);
    };
    window.confirm = () => true;
  });
};

const getPlausibleEvents = async (page: Page) =>
  page.evaluate(() => (window as any).plausibleEvents ?? []);

const waitForAnalyticsEvent = async (
  page: Page,
  name: string,
  minCount = 1
) =>
  page.waitForFunction(
    ([eventName, required]) => {
      const events = (window as any).plausibleEvents ?? [];
      return events.filter((entry: any) => entry.event === eventName).length >= required;
    },
    [name, minCount]
  );

const shouldLogMocks = (process.env.PLAYWRIGHT_TEST ?? "").trim().toLowerCase() === "true";
const logMockRoute = (label: string, route: Route) => {
  if (!shouldLogMocks) return;
  const request = route.request();
  console.log(`[near-ai-assistant mock] ${label} ${request.method()} ${request.url()}`);
};

describeSpec("NEAR AI assistant chat", () => {
  test("streams NEAR AI completions, verification, errors, quick actions, and analytics", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    if (shouldLogMocks) {
      page.on("request", (request) => {
        if (request.url().includes("/api/agent") || request.url().includes("/api/chat")) {
          console.log(">>> Request:", request.method(), request.url());
        }
      });
      page.on("response", (response) => {
        if (response.url().includes("/api/agent") || response.url().includes("/api/chat")) {
          console.log(">>> Response:", response.status(), response.url());
        }
      });
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
          consoleErrors.push(`${msg.type()}: ${msg.text()}`);
        }
      });
    }
    await ensurePlausibleSpy(page);
    registerPlaywrightMocks(page, { skipChatCompletionsStream: true });

    let chatMock: ChatMockResponse = {
      type: "stream",
      events: buildSuccessStream({
        prefix: "initial",
        intro: "I can surface the latest proposals for you.",
        finalMessage: "Overview of proposals with verification proof.",
      }),
    };
    registerMockVerificationSessionsForEvents(chatMock.events);

    await page.unroute("**/api/agent");
    await page.unroute("**/api/agent**");
    await page.route("**/api/agent**", async (route) => {
      logMockRoute("api/agent override", route);
      if (chatMock.type === "stream") {
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
          body: createSsePayload(chatMock.events),
        });
        return;
      }

      await route.fulfill({
        status: chatMock.status,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chatMock.body),
      });
    });

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("I can help you participate in the House of Stake.")).toBeVisible();
    await waitForAnalyticsEvent(page, "agent_chat_opened");

    const input = page.getByTestId("chat-input");
    chatMock = {
      type: "stream",
      events: buildSuccessStream({
        prefix: "typed",
        intro: "Here is an early summary of the horizon proposals.",
        finalMessage: "Overview of proposals with verification proof.",
      }),
    };
    registerMockVerificationSessionsForEvents(chatMock.events);
    await input.fill("What are the latest governance proposals?");
    const agentResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/agent") && response.status() === 200
    );
    await page.keyboard.press("Enter");

    const typingIndicator = page.getByTestId("typing-indicator").first();
    await typingIndicator.waitFor({ state: "visible", timeout: 5000 });
    const streamResponse = await agentResponsePromise;
    await streamResponse.finished();
    await expect(page.getByText("Overview of proposals with verification proof.")).toBeVisible({
      timeout: 10000,
    });

    const proofTrigger = page.getByTestId("verification-proof-trigger").first();
    await expect(proofTrigger).toBeVisible();
    await proofTrigger.click();
    await expect(page.getByRole("button", { name: /Export Proof/i })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("heading", { name: /NEAR Proposal typed Alpha/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /NEAR Proposal typed Beta/ })).toBeVisible();

    await page.evaluate(() => {
      const feed = document.querySelector<HTMLElement>('[data-testid="chat-feed"]');
      if (feed) {
        feed.scrollTop = 0;
      }
    });
    await expect(page.getByTestId("scroll-to-bottom")).toBeVisible();
    await page.getByTestId("scroll-to-bottom").click();
    await expect(page.getByText("Overview of proposals with verification proof.")).toBeVisible();

    chatMock = {
      type: "stream",
      events: buildSuccessStream({
        prefix: "quick",
        intro: "This quick action is summarizing two highlighted proposals.",
        finalMessage: "Quick action response and final verification.",
      }),
    };
    registerMockVerificationSessionsForEvents(chatMock.events);
    await page.getByRole("button", { name: "Recent proposals" }).click();
    const quickTypingIndicator = page.getByTestId("typing-indicator").first();
    await quickTypingIndicator.waitFor({ state: "visible", timeout: 5000 });
    await expect(page.getByText("Quick action response and final verification.")).toBeVisible();

    const analyticsEvents = await getPlausibleEvents(page);
    const messageEvents = analyticsEvents.filter(
      (entry: any) => entry.event === "agent_chat_message_sent"
    );
    expect(messageEvents.length).toBeGreaterThanOrEqual(2);
    expect(messageEvents[1].props?.has_history).toBe(true);

    await page.getByLabel("Clear conversation").click();
    await expect(page.getByText("Welcome")).toBeVisible();
    await waitForAnalyticsEvent(page, "agent_chat_cleared");

    chatMock = {
      type: "error",
      status: 400,
      body: { error: "Mock 400 error", details: "Bad payload" },
    };
    await input.fill("Trigger 400");
    await page.keyboard.press("Enter");
    await expect(
      page.getByLabel("Notifications").getByText(/Mock 400 error/)
    ).toBeVisible();

    chatMock = {
      type: "stream",
      events: buildSuccessStream({
        prefix: "recover",
        intro: "Recovering with a validated summary.",
        finalMessage: "Recovered from 400 with a fresh plan.",
      }),
    };
    registerMockVerificationSessionsForEvents(chatMock.events);
    await input.fill("Recover after 400");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Recovered from 400 with a fresh plan.")).toBeVisible();
    await expect(page.locator("text=Mock 400 error")).toHaveCount(0);

    chatMock = {
      type: "error",
      status: 500,
      body: { error: "Mock 500 error", details: "Server failed" },
    };
    await input.fill("Trigger 500");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Mock 500 error/)).toBeVisible();

    chatMock = {
      type: "stream",
      events: buildSuccessStream({
        prefix: "after500",
        intro: "Continuing despite the earlier server hiccup.",
        finalMessage: "After 500 summary with verification proof.",
      }),
    };
    registerMockVerificationSessionsForEvents(chatMock.events);
    await input.fill("Keep going");
    await page.keyboard.press("Enter");
    await expect(page.getByText("After 500 summary with verification proof.")).toBeVisible();

    await page.goto("/proposals", { waitUntil: "domcontentloaded" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /NEAR Proposal after500 Alpha/ })).toBeVisible();
    await waitForAnalyticsEvent(page, "agent_chat_opened", 2);

    await page.evaluate(() => {
      const feed = document.querySelector<HTMLElement>('[data-testid="chat-feed"]');
      if (feed) {
        feed.scrollTop = 0;
      }
    });
    await expect(page.getByTestId("scroll-to-bottom")).toBeVisible();
    await page.getByTestId("scroll-to-bottom").click();

    chatMock = {
      type: "stream",
      events: buildSuccessStream({
        prefix: "final",
        intro: "A rapid follow-up run from the reopened window.",
        finalMessage: "Rapid follow-up summary after navigation.",
      }),
    };
    registerMockVerificationSessionsForEvents(chatMock.events);
    await page.getByRole("button", { name: "Recent proposals" }).click();
    await expect(page.getByText("Rapid follow-up summary after navigation.")).toBeVisible();

    const finalEvents = await getPlausibleEvents(page);
    const finalMessageEvents = finalEvents.filter(
      (entry: any) => entry.event === "agent_chat_message_sent"
    );
    expect(finalMessageEvents.length).toBeGreaterThanOrEqual(4);
    if (shouldLogMocks) {
      console.log("Console errors:", consoleErrors);
    }
  });
});
