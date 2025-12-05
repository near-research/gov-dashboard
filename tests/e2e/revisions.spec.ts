import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";

const { describe: describeSpec } = createPlaywrightGuard("revisions.spec.ts");

describeSpec("Proposal revision comparison", () => {
  test("shows diff content, revision summary, and verification proof modal", async ({ page }) => {
    registerPlaywrightMocks(page);

    await page.goto("/proposals/42", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Mock Proposal for Playwright/i })).toBeVisible();
    await expect(page.getByText(/Version 3/)).toBeVisible();

    await page.click("#version-select");
    await page.getByRole("option", { name: "v2" }).click();
    await expect(page.getByText(/Version 2/)).toBeVisible({ timeout: 10000 });

    const diffToggle = page.getByLabel("Show changes");
    await expect(diffToggle).toBeVisible();
    await diffToggle.click();
    await expect(page.getByText("Updated KPIs with target values.")).toBeVisible();

    await page.getByRole("button", { name: /Summarize All Revisions/i }).click();
    await expect(
      page
        .getByText("Mock revision summary describing the key edits and why they matter for reviewers.")
        .first()
    ).toBeVisible({ timeout: 15000 });

    const summaryAlert = page
      .getByRole("alert")
      .filter({ hasText: "Revision History Summary" })
      .first();
    const proofTrigger = summaryAlert.getByTestId("verification-proof-trigger").first();

    await proofTrigger.click();
    await expect(page.getByText("Model Attestation")).toBeVisible({ timeout: 10000 });

    await page.keyboard.press("Escape");
    await proofTrigger.click();
    await expect(page.getByText("Model Attestation")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
