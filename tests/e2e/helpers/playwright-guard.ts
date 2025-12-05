import { test } from "@playwright/test";

const truthyValues = new Set(["1", "true", "yes", "on"]);

const formatFileLabel = (fileName: string) => fileName.replace(/^\.\//, "");

export const createPlaywrightGuard = (fileName: string) => {
  const rawFlag = (process.env.PLAYWRIGHT_TEST ?? "").trim().toLowerCase();
  const enabled = truthyValues.has(rawFlag);

  if (!enabled) {
    console.info(
      `[playwright] Skipping ${formatFileLabel(fileName)}; set PLAYWRIGHT_TEST=true to run Playwright.`
    );
  }

  return {
    enabled,
    describe: enabled ? test.describe : test.describe.skip,
  };
};
