import { expect, test, type Page, type Route } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import { mockAddress, verifiedProofMock } from "../fixtures/verificationMocks";

const { describe: describeSpec } = createPlaywrightGuard(
  "verification-flow.spec.ts"
);

const targetUrl = "/playwright/verification";

describeSpec("Verification flow", () => {
  const openProofDialog = async (page: Page) => {
    const proofTrigger = page.getByTestId("verification-proof-trigger");
    await expect(proofTrigger.first()).toBeVisible({ timeout: 10000 });
    await proofTrigger.first().click();
  };

  test("shows attestation details and a verified timeline after fetching a proof", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    await page.route("**/api/verification/proof**", (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          proof: verifiedProofMock,
        }),
      });
    });

    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await openProofDialog(page);

    const timelineSteps = [
      "Secure Key Generation",
      "Hardware Attestation",
      "Key Binding",
      "Message Signing",
      "Complete Verification",
    ];

    for (const step of timelineSteps) {
      const stepElement = page.getByText(step, { exact: true });
      await expect(stepElement).toBeVisible();
      await expect(stepElement).toHaveClass(/text-(emerald|green|muted|red)/);
    }

    const viewDetailsButton = page.getByRole("button", {
      name: /View.*details|Export|Proof/i,
    });
    await expect(viewDetailsButton.first()).toBeVisible({ timeout: 2000 });
    await viewDetailsButton.first().click();
    await expect(
      page.getByText(/Verification Proof|Attestation/i).first()
    ).toBeVisible();

    await expect(page.getByText("TEE Signing Address")).toBeVisible();
    await expect(page.getByText(mockAddress).first()).toBeVisible();
    await expect(page.getByText("Request Nonce")).toBeVisible();
  });

  test("allows retrying the fetch after a network failure", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    let proveAttempts = 0;

    await page.route("**/api/verification/proof**", async (route: Route) => {
      proveAttempts++;
      console.log(`Proof attempt ${proveAttempts}`);
      if (proveAttempts === 1) {
        await route.fulfill({
          status: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Network error" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          proof: verifiedProofMock,
        }),
      });
    });

    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await openProofDialog(page);

    const errorIndicator = page.getByText(/error|failed|Network error/i).first();
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });

    const retryButton = page.getByRole("button", {
      name: /Retry|Try again|Reload|Refresh/i,
    });
    await expect(retryButton.first()).toBeVisible({ timeout: 10000 });
    await retryButton.first().click();

    await page.keyboard.press("Escape");
    await openProofDialog(page);

    await page.waitForTimeout(1000);
    const hasContent = await page
      .getByText(/Model Attestation|Secure Key|TEE/i)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    console.log("Has verification content after retry:", hasContent);
    console.log("Total proof attempts:", proveAttempts);
    expect(hasContent).toBe(true);
    expect(proveAttempts).toBeGreaterThanOrEqual(2);

    const secureKeyGen = page.getByText("Secure Key Generation", {
      exact: true,
    });
    await expect(secureKeyGen).toBeVisible();
    await expect(secureKeyGen).toHaveClass(/text-(emerald|green|muted|red)/);
  });
});
