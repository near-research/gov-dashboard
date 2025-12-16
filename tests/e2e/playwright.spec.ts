import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import { dismissPopups, waitForAppReady } from "./helpers/setup";

const { describe: describeSpec } = createPlaywrightGuard(
  "playwright-flows.spec.ts"
);

describeSpec("Playwright regression flows", () => {
  test("screens a proposal, summarizes discussion & replies, and runs live chat", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    await page.goto("/test/playwright/screening", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await dismissPopups(page);
    await expect(
      page.getByRole("heading", { name: /AI Proposal Screening/i })
    ).toBeVisible();
    await page.fill("#title", "Streamlined Governance");
    await page.fill(
      "#proposal",
      "This mock proposal includes objectives and measurable KPIs."
    );
    await page.click("button:has-text('Screen Proposal')");
    const statusAlert = page.getByRole("alert").first();
    await expect(
      statusAlert.getByTestId("screening-status")
    ).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/Mock screening result/)).toBeVisible();
    await expect(page.getByText(/AI Screened & Approved/)).toBeVisible();

    await page.goto("/test/playwright/summaries", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await dismissPopups(page);
    await page.click("button:has-text('Summarize Discussion')");
    await expect(page.getByTestId("discussion-summary-result")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("discussion-summary-result")).toContainText(
      "Mock discussion summary"
    );
    await page.click("button:has-text('Summarize Reply')");
    await expect(page.getByTestId("reply-summary-result")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("reply-summary-result")).toContainText(
      "Mock reply summary"
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await dismissPopups(page);
    const prompt = page.getByTestId("chat-input");
    await expect(prompt).toBeVisible();

    const verificationRequest = page.waitForRequest(
      (req) =>
        req.url().endsWith("/api/verification/session") &&
        req.method() === "POST"
    );
    const agentRequest = page.waitForRequest(
      (req) => req.url().endsWith("/api/agent") && req.method() === "POST"
    );

    await prompt.fill("What is the latest governance plan?");
    await page.keyboard.press("Enter");
    await Promise.all([verificationRequest, agentRequest]);
    await expect(prompt).toHaveValue("");
  });
});
