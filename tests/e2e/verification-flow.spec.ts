import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import { dismissPopups, waitForAppReady } from "./helpers/setup";

const { describe: describeSpec } = createPlaywrightGuard(
  "verification-flow.spec.ts"
);

describeSpec("Verification Flow", () => {
  test("chat message triggers verification session", async ({ page }) => {
    await registerPlaywrightMocks(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await dismissPopups(page);

    const chatInput = page.getByTestId("chat-input");
    await expect(chatInput).toBeVisible({ timeout: 15_000 });
    await chatInput.fill("Test message for verification flow");

    const verificationRequestPromise = page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/verification/session") &&
        request.method() === "POST"
    );

    const verificationSessionPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/verification/session") &&
        response.request().method() === "POST"
    );

    await page.keyboard.press("Enter");

    const verificationRequest = await verificationRequestPromise;
    const sessionResponse = await verificationSessionPromise;
    const requestBody = JSON.parse(
      verificationRequest.postData() ?? "{}"
    );
    expect(requestBody).toHaveProperty("verificationId");

    expect(sessionResponse.status()).toBe(200);
    const sessionData = await sessionResponse.json();
    expect(sessionData).toHaveProperty("verificationId");
    expect(sessionData).toHaveProperty("nonce");
  });

  test("verification endpoints return expected status codes", async ({ request }) => {
    const sessionResp = await request.post("/api/verification/session", {
      data: { verificationId: "e2e-test-123" },
    });
    expect(sessionResp.status()).toBe(200);

    const sessionJson = await sessionResp.json();
    expect(sessionJson.nonce).toBeTruthy();

    const proofResp = await request.post("/api/verification/proof", {
      data: { verificationId: "e2e-test-123" },
    });
    expect(proofResp.status()).not.toBe(404);
  });
});
