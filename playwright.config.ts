import { defineConfig, devices } from "@playwright/test";

// Allow overriding port/host; fall back to a higher, less contended port for local dev.
const port = process.env.PLAYWRIGHT_PORT || process.env.PORT || "3000";
const host = process.env.PLAYWRIGHT_HOST || "localhost";
const hostForBrowser = host === "0.0.0.0" ? "127.0.0.1" : host;
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL || `http://${hostForBrowser}:${port}`;

// Default to auto-starting the dev server; set PLAYWRIGHT_START_SERVER=false to opt out.
const startServer = process.env.PLAYWRIGHT_START_SERVER !== "false";

// Default to mock verification endpoints during Playwright runs unless explicitly overridden
process.env.VERIFY_USE_MOCKS = process.env.VERIFY_USE_MOCKS ?? "true";

export default defineConfig({
  testDir: "./tests/e2e",
  // Only run Playwright specs (avoid picking up unit tests in tests/unit)
  testMatch: /.*\.spec\.(ts|tsx|js|cts|cjs)/,
  retries: 0,
  use: {
    baseURL,
    // Prefer system Chrome to avoid sandbox restrictions in some environments
    channel: "chrome",
    trace: "on-first-retry",
    headless: true,
    launchOptions: {
      args: ["--no-sandbox"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: startServer
    ? {
        command:
          process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ||
          `npm run dev -- --hostname ${host} --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
