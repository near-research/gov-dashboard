import { type Page, test, expect } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import proposalDetailFixture from "../fixtures/playwright/proposal-detail.json";

interface ChatCompletionPayload {
  model?: string;
  messages?: Array<{ content?: string }>;
  choices?: Array<{ message?: { content?: string } }>;
  [key: string]: unknown;
}

const { describe: describeSpec } = createPlaywrightGuard("settings.spec.ts");

const getTextareaByLabel = (page: Page, label: string) =>
  page.getByLabel(new RegExp(label, "i"));

const getInputByLabel = (page: Page, label: string) =>
  page.getByLabel(new RegExp(label, "i"));

const stubChatCompletion = (
  page: Page,
  options: {
    status?: number;
    payload?: ChatCompletionPayload;
    delayMs?: number;
    capture?: (body: ChatCompletionPayload) => void;
  }
) => {
  page.route("**/api/chat/completions", async (route) => {
    const rawBody = route.request().postData() ?? "";
    const parsedBody = (rawBody ? JSON.parse(rawBody) : {}) as ChatCompletionPayload;
    options.capture?.(parsedBody);
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    route.fulfill({
      status: options.status ?? 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        (options.payload ?? { choices: [] }) as ChatCompletionPayload
      ),
    });
  });
};

const stubProposalFailure = (page: Page, proposalId: string) => {
  page.route(new RegExp(`/api/proposals/${proposalId}(?:\\?.*)?$`), (route) => {
    if (route.request().method() === "GET") {
      route.fulfill({
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Not found" }),
      });
      return;
    }
    route.continue();
  });
};

describeSpec("settings lab", () => {
  test("summarize revisions prompt loads Discourse timeline and runs NEAR AI chat/completions", async ({
    page,
  }) => {
    let capturedPayload: ChatCompletionPayload | null = null;

    stubChatCompletion(page, {
      delayMs: 100,
      payload: {
        choices: [
          {
            message: { content: "NEAR AI has summarized the revisions." },
          },
        ],
      },
      capture: (body) => {
        capturedPayload = body;
      },
    });

    registerPlaywrightMocks(page);

    // /settings is public; there is no auth gate, so we can land on the lab without wallet flows.
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Laboratory" })).toBeVisible();

    await page.getByRole("combobox", { name: /Select prompt/i }).click();
    await page.getByRole("option", { name: "Summarize Revisions" }).click();

    await page.getByRole("combobox", { name: /Choose model/i }).click();
    await page.getByRole("option", { name: "OpenAI GPT OSS 120B" }).click();

    await page.getByRole("button", { name: /Autofill/i }).click();
    await page.getByPlaceholder("Forum Topic ID").fill(String(proposalDetailFixture.topic_id));
    await page.getByRole("button", { name: /Load/i }).click();
    await expect(page.getByRole("button", { name: "Loading..." })).toBeVisible();
    await expect(page.getByRole("button", { name: /Load/i })).toBeVisible();

    await expect(getTextareaByLabel(page, "Author Username")).toHaveValue(
      proposalDetailFixture.username
    );
    await expect(getTextareaByLabel(page, "Revision Timeline")).toHaveValue(/v1/);

    await page.getByRole("button", { name: /Run Prompt/i }).click();

    await expect(page.getByText("NEAR AI has summarized the revisions.")).toBeVisible({
      timeout: 10000,
    });
    const payload = capturedPayload as ChatCompletionPayload | null;
    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error("Expected chat completion payload");
    }
    expect(payload.model).toBe("openai/gpt-oss-120b");
    expect(String(payload.messages?.[0]?.content ?? "")).toContain("Revision Timeline");
  });

  test("summarize reply autofill handles reply selection, proposals errors, and NEAR AI failures", async ({
    page,
  }) => {
    stubChatCompletion(page, {
      status: 413,
      payload: { error: "Invalid payload" },
      capture: () => {},
    });

    registerPlaywrightMocks(page);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("combobox", { name: /Select prompt/i }).click();
    await page.getByRole("option", { name: "Summarize Reply" }).click();

    await page.getByRole("button", { name: /Autofill/i }).click();
    await page.getByPlaceholder("Forum Topic ID").fill(String(proposalDetailFixture.topic_id));
    await page.locator("#reply-post-number-to-load").fill("2");
    await page.getByRole("button", { name: /Load/i }).click();
    await expect(getTextareaByLabel(page, "Reply Author")).toHaveValue("supporter");

    const failureId = "999";
    stubProposalFailure(page, failureId);
    await page.getByPlaceholder("Forum Topic ID").fill(failureId);
    await page.getByRole("button", { name: /Load/i }).click();
    await expect(page.getByText("Failed to load proposal")).toBeVisible();

    await page.getByRole("button", { name: /Run Prompt/i }).click();
    await expect(page.getByText(/Invalid payload|error/i)).toBeVisible();
  });

  test("custom prompts extract template variables and reset when switching prompts", async ({ page }) => {
    let capturedPayload: ChatCompletionPayload | null = null;

    stubChatCompletion(page, {
      payload: {
        choices: [
          { message: { content: "Custom NEAR AI response includes formal tone." } },
        ],
      },
      capture: (body) => {
        capturedPayload = body;
      },
    });

    registerPlaywrightMocks(page);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Autofill/i })).toBeVisible();

    const customPromptTextarea = page.locator("#custom-prompt-text");
    await customPromptTextarea.fill(
      "Summarize the proposal with {tone} delivery and mention {project}."
    );
    const toneInput = page.locator("#custom-variable-tone");
    await expect(toneInput).toBeVisible();
    await toneInput.fill("concise");
    await page.locator("#custom-variable-project").fill("Governance Lab");

    await getTextareaByLabel(page, "Title").fill("NEAR Governance Deck");
    await getTextareaByLabel(page, "Content").fill("All the proposal details in markdown.");

    await page.getByRole("combobox", { name: /Select prompt/i }).click();
    await page.getByRole("option", { name: "Summarize Proposal" }).click();
    await page.getByRole("combobox", { name: /Select prompt/i }).click();
    await page.getByRole("option", { name: "Custom" }).click();

    await expect(customPromptTextarea).toHaveValue("");
    const toneInputAfterReset = page.locator("#custom-variable-tone");
    await expect(toneInputAfterReset).toBeVisible();
    await toneInputAfterReset.fill("formal");

    await page.getByRole("button", { name: /Run Prompt/i }).click();
    await expect(page.getByText("Custom NEAR AI response includes formal tone.")).toBeVisible();
    const customPayload = capturedPayload as ChatCompletionPayload | null;
    expect(customPayload).not.toBeNull();
    if (!customPayload) {
      throw new Error("Missing chat completion payload for custom prompt");
    }
    expect(String(customPayload.messages?.[0]?.content ?? "")).toContain("formal");
    expect(String(customPayload.messages?.[0]?.content ?? "")).toContain("Governance Lab");
  });
});
