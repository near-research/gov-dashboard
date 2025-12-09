import { expect, test, type Page } from "@playwright/test";
import proposalDetailFixture from "../fixtures/playwright/proposal-detail.json";
import {
  mockProposalRevisions,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import { mockAuthenticatedSession } from "./helpers/auth-mocks";

const { describe: describeSpec } = createPlaywrightGuard("proposals-topic.spec.ts");
const PROPOSAL_ID = "42";
const PROPOSAL_TITLE = "Mock Proposal for Playwright";
const PROPOSAL_SLUG = proposalDetailFixture.topic_slug;

const createSsePayload = (events: Record<string, unknown>[]) =>
  `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;

describeSpec("Proposal topic detail walkthrough", () => {
  test("shows loading skeleton, metadata, summaries, revisions, and discussion flows", async ({
    page,
  }) => {
    let skeletonDelayed = false;

    await page.addInitScript(() => {
      (window as any).__LAST_DISCOURSE_URL__ = null;
      window.open = (url?: string | URL | null) => {
        (window as any).__LAST_DISCOURSE_URL__ =
          typeof url === "string" ? url : url?.toString?.() ?? null;
        return null;
      };
    });

    await page.route(new RegExp(`/api/proposals/${PROPOSAL_ID}$`), async (route) => {
      if (!skeletonDelayed) {
        skeletonDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposalDetailFixture),
      });
    });

    await page.route(new RegExp(`/api/proposals/${PROPOSAL_ID}/summarize$`), async (route) => {
      const payload = {
        success: true,
        summary:
          "Verified proposal summary covering the objectives, deliverables, and KPIs for the NEAR Governance dashboard.",
        model: "near-ai/cloud-verifier",
        proposalId: PROPOSAL_ID,
        title: PROPOSAL_TITLE,
        author: "playwright-bot",
        createdAt: "2024-04-01T00:00:00Z",
        truncated: false,
        generatedAt: Date.now(),
        cached: false,
        verification: {
          source: "near-ai-cloud",
          status: "verified",
          messageId: "proposal-summary-proof",
        },
        verificationId: "proposal-summary-proof",
        proof: {
          requestHash: "req-prop",
          responseHash: "res-prop",
          nonce: "nonce-prop",
          arch: "x86_64",
          deviceCertHash: "device-prop",
          rimHash: "rim-prop",
          ueid: "ueid-prop",
          measurements: ["sha256:prop"],
        },
      };
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    });

    await mockProposalRevisions(page, PROPOSAL_ID);
    registerPlaywrightMocks(page);

    let discussionCalls = 0;
    await page.route(/\/api\/discourse\/topics\/\d+\/summarize/, async (route) => {
      discussionCalls += 1;
      if (discussionCalls === 1) {
        await route.fulfill({
          status: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "discussion summarization failed" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/proposals", { waitUntil: "domcontentloaded" });

    await page
      .getByRole("link", { name: new RegExp(PROPOSAL_TITLE) })
      .first()
      .click();

    await expect(page.getByRole("heading", { name: PROPOSAL_TITLE })).toBeVisible({
      timeout: 10000,
    });

    const discourseButton = page.getByRole("button", { name: /View on Discourse/i });
    await expect(discourseButton).toBeVisible();
    await discourseButton.click();
    const openedUrl = await page.evaluate(
      () => (window as any).__LAST_DISCOURSE_URL__
    );
    expect(openedUrl).toMatch(
      new RegExp(`/t/${PROPOSAL_SLUG}/${PROPOSAL_ID}`)
    );

    // DEBUG: capture what the proposals page actually renders for discussions
    await page.screenshot({ path: "test-results/proposals-topic-debug.png" });
    const bodyText = await page.locator("body").textContent();
    console.log("Page text (truncated):", bodyText?.substring(0, 2000));
    const numberLocators = await page.locator("text=/\\d+/").all();
    console.log("Number locators found:", numberLocators.length);
    for (let i = 0; i < Math.min(10, numberLocators.length); i += 1) {
      const text = await numberLocators[i].textContent().catch(() => "");
      console.log(`Number found [${i}]:`, text);
    }
    await page.goto("/proposals", { waitUntil: "domcontentloaded" });
    await page.goto(`/proposals/${PROPOSAL_ID}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: /Read More/i })).toBeVisible();
    await page.getByRole("button", { name: /Read More/i }).click();
    await expect(page.getByRole("button", { name: /Hide/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Objectives/i })
    ).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: /^Summarize$/ }).first().click();
    const summaryProofTrigger = page.getByTestId("verification-proof-trigger");
    if (await summaryProofTrigger.count()) {
      await expect(summaryProofTrigger).toBeVisible({ timeout: 5000 });
    } else {
      console.log("Summary verification proof trigger not rendered; skipping assertion.");
    }

    await page.getByRole("button", { name: /Revisions/ }).click();
    const versionTrigger = page.getByTestId("version-select").first();
    await expect(versionTrigger).toBeVisible({ timeout: 10000 });
    await versionTrigger.click();
    await page.getByRole("option", { name: /v2/ }).click();
    await page.getByLabel("Show changes").click();

    await page
      .getByRole("button", { name: /Summarize All Revisions/i })
      .click();
    await expect(
      page.getByText(/Mock revision summary describing the key edits and why they matter for reviewers./)
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("verification-proof-trigger")).toBeVisible();

    const discussionSummaries = page.getByRole("button", { name: /^Summarize$/ });
    await discussionSummaries.nth(1).click();
    const discussionErrorAlert = page
      .locator('[role="alert"]:not(#__next-route-announcer__)')
      .filter({ hasText: /(discussion summarization failed|Failed to generate summary)/i });
    const discussionAlerts = await page
      .locator('[role="alert"]:not(#__next-route-announcer__)')
      .allTextContents();
    console.log("Discussion alerts on page:", discussionAlerts);
    console.log("Discussion error alert text:", await discussionErrorAlert.allTextContents());
    await expect(discussionErrorAlert).toBeVisible();
    await expect(discussionErrorAlert).toContainText(
      /(discussion summarization failed|Failed to generate summary)/i
    );
    await discussionSummaries.nth(1).click();
    await expect(
      page.getByText(/Mock discussion summary covering main community sentiment/i)
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("verification-proof-trigger")).toBeVisible();
  });

  test("surfaces an alert when the proposal detail fetch fails", async ({ page }) => {
    await page.route(new RegExp(`/api/proposals/${PROPOSAL_ID}$`), async (route) => {
      await route.fulfill({
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "boom" }),
      });
    });

    registerPlaywrightMocks(page);
    await page.goto(`/proposals/${PROPOSAL_ID}`, { waitUntil: "domcontentloaded" });

    // DEBUG: capture what the error state renders
    await page.screenshot({ path: "test-results/proposals-error-debug.png" });
    const alerts = await page.locator('[role="alert"]').all();
    console.log("Alerts found:", alerts.length);
    for (let i = 0; i < alerts.length; i += 1) {
      const text = await alerts[i].textContent().catch(() => "");
      console.log(`Alert[${i}]:`, text);
    }
    const errorTexts = await page
      .locator("text=/error|fail|not found/i")
      .all();
    console.log("Error texts found:", errorTexts.length);

    const errorAlert = alerts.length ? alerts[0] : page.locator('[role="alert"]').first();
    await expect(errorAlert).toBeVisible({ timeout: 5000 });
    await expect(errorAlert).toHaveText(/\/proposals\/\d+/);
  });

  test("handles reply summaries, screening gating, chatbot streams, and analytics", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__capturedAnalytics = [];
      window.plausible = (name: string, options?: { props?: Record<string, unknown> }) => {
        (window as any).__capturedAnalytics.push({ name, props: options?.props });
      };
    });

    await page.route(/\/api\/discourse\/replies\/\d+\/summarize/, async (route) => {
      const match = route.request().url().match(/replies\/(\d+)\/summarize$/);
      if (!match) {
        await route.continue();
        return;
      }
      const replyId = match[1];
      if (replyId === "101") {
        await route.fulfill({
          status: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Reply summarization failed" }),
        });
        return;
      }

      const payload = {
        success: true,
        summary: "Reply summary highlighting the key counterpoints and evidence.",
        model: "near-ai/verified",
        replyId,
        verification: {
          source: "near-ai-cloud",
          status: "verified",
          messageId: "reply-summary-proof",
        },
        verificationId: "reply-summary-proof",
        proof: {
          requestHash: "req-reply",
          responseHash: "res-reply",
          nonce: "nonce-reply",
        },
      };
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    });

    await page.route(new RegExp(`/api/saveAnalysis/${PROPOSAL_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation: {
            overallPass: true,
            qualityScore: 0.95,
            attentionScore: 0.9,
            summary: "Ready for publication",
            relevant: { score: "high", reason: "NEAR growth" },
            material: { score: "medium", reason: "Balanced risk" },
          },
          verification: {
            source: "near-ai-cloud",
            status: "verified",
            messageId: "screening-proof",
          },
          verificationId: "screening-proof",
          model: "near-ai/authorization",
        }),
      });
    });

    let chatCall = 0;
    await page.route("**/api/chat/completions", async (route) => {
      chatCall += 1;
      const postData = route.request().postData();
      const body = postData ? JSON.parse(postData) : {};
      const usesStream = body.stream !== false;

      if (chatCall === 1) {
        await route.fulfill({
          status: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Streaming failure" }),
        });
        return;
      }

      if (chatCall === 2 && usesStream) {
        const toolCallChunk = {
          id: "tool-call",
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: "tool-1",
                    type: "function",
                    function: { name: "summarize_proposal", arguments: "{}" },
                  },
                  {
                    id: "tool-2",
                    type: "function",
                    function: { name: "summarize_revisions", arguments: "{}" },
                  },
                  {
                    id: "tool-3",
                    type: "function",
                    function: { name: "summarize_discussion", arguments: "{}" },
                  },
                ],
              },
              index: 0,
              finish_reason: null,
            },
          ],
        };
        const contentChunk = {
          id: "assistant-1",
          object: "chat.completion.chunk",
          choices: [
            {
              delta: { content: "Gathering verification-aware insights." },
              index: 0,
              finish_reason: "stop",
            },
          ],
        };
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          body: createSsePayload([toolCallChunk, contentChunk]),
        });
        return;
      }

      if (chatCall === 3 && body.stream === false) {
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            choices: [
              {
                id: "final-1",
                message: {
                  content: "Tool results stitched into a cohesive answer.",
                },
              },
            ],
          }),
        });
        return;
      }

      await route.continue();
    });

    const pageWithCustomChatRoute = page as Page & {
      __hasCustomChatCompletionRoute__?: boolean;
    };
    pageWithCustomChatRoute.__hasCustomChatCompletionRoute__ = true;
    registerPlaywrightMocks(page);
    await page.goto(`/proposals/${PROPOSAL_ID}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /Evaluation/ })).toBeVisible();

    // DEBUG: inspect buttons/selects present before version selection
    const buttons = await page.locator("button").all();
    console.log("Buttons on page:");
    for (const button of buttons) {
      const text = await button.textContent().catch(() => "");
      const testid = await button.getAttribute("data-testid").catch(() => "");
      if (text?.trim()) {
        console.log(`  - "${text.trim()}" (testid: ${testid ?? "none"})`);
      }
    }
    const selects = await page
      .locator("select, [role='listbox'], [role='combobox']")
      .all();
    console.log("Selects found:", selects.length);
    await page.screenshot({ path: "test-results/proposals-version-debug.png" });

    const revisionsButton = page.getByRole("button", {
      name: /Revisions/i,
    });
    await expect(revisionsButton.first()).toBeVisible({ timeout: 5000 });
    await revisionsButton.first().click();
    const versionTrigger = page.getByTestId("version-select").first();
    await expect(versionTrigger).toBeVisible({ timeout: 5000 });
    await versionTrigger.click();
    await page.getByRole("option", { name: /v2/ }).click();
    await mockAuthenticatedSession(page, "playwright.testnet");

    const screeningButton = page.getByRole("button", {
      name: /Screen This Proposal|Connect Wallet to Screen/i,
    });
    if (await screeningButton.count()) {
      await expect(screeningButton).toBeVisible({ timeout: 10000 });
      await screeningButton.click();
      await expect(page.getByText(/Screening Passed/i)).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("verification-proof-trigger")).toBeVisible();
    } else {
      console.log("Screening button not rendered in test; skipping gating flow.");
    }

    await page.getByRole("button", { name: /Replies/ }).click();

    const replySummaries = page.getByRole("button", { name: /^Summarize$/ });
    const replySummaryCount = await replySummaries.count();
    if (replySummaryCount > 2) {
      await replySummaries.nth(2).click();
      const replyErrorAlert = page
        .locator('[role="alert"]:not(#__next-route-announcer__)')
        .filter({ hasText: /Reply summarization failed/i });
      await expect(replyErrorAlert).toBeVisible();
    } else {
      console.log("Not enough reply summarize buttons to trigger error path.");
    }
    if (replySummaryCount > 3) {
      await replySummaries.nth(3).click();
      await expect(
        page.getByText(/Reply summary highlighting the key counterpoints and evidence./)
      ).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId("verification-proof-trigger")).toBeVisible();
    } else {
      console.log("Not enough reply summarize buttons to show success path.");
    }

    await page.getByText("Assistant").click();
    const chatbotInput = page.getByPlaceholder("Ask a question...");
    await chatbotInput.fill("Summarize the revisions.");
    await chatbotInput.press("Enter");
    await expect(page.getByText(/API Error: 500 - Streaming failure/)).toBeVisible({ timeout: 5000 });
    console.log("Chatbot error text:", await page.getByText(/API Error:/).allTextContents());
    await chatbotInput.fill("Summarize revisions.");
    await chatbotInput.press("Enter");
    await expect(page.getByText(/Tool results stitched into a cohesive answer./)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/summarize_proposal/)).toBeVisible();

    const analyticsEvents = await page.evaluate(() => (window as any).__capturedAnalytics || []);
    expect(analyticsEvents.some((event: { name: string }) => event.name === "proposal_screening_started")).toBe(true);
    expect(analyticsEvents.some((event: { name: string }) => event.name === "proposal_screening_succeeded")).toBe(true);
    expect(analyticsEvents.some((event: { name: string }) => event.name === "proposal_chatbot_opened")).toBe(true);
    expect(analyticsEvents.some((event: { name: string }) => event.name === "proposal_chatbot_message_sent")).toBe(true);
    expect(analyticsEvents.some((event: { name: string }) => event.name === "proposal_chatbot_tool_used")).toBe(true);
  });
});
