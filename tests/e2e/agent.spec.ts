import { expect, test } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";

const { describe: describeSpec } = createPlaywrightGuard("agent.spec.ts");

describeSpec("NEAR AI assistant chat", () => {
  test("renders welcome text and streams a mocked assistant response", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByText("I can help you participate in the House of Stake.")
    ).toBeVisible();

    const input = page.getByTestId("chat-input");
    await input.fill("Show me a mock response");
    await page.keyboard.press("Enter");

    await expect(
      page.getByText(/NEAR AI assistant says hello from the mocked stream\./)
    ).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText(/Here is a quick plan for governance updates\./)
    ).toBeVisible();
    await expect(page.getByText(/Final thought from NEAR AI\./)).toBeVisible();
  });
});
