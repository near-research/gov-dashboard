import { describe, expect, it, vi } from "vitest";

const RATE_LIMIT_ENV_KEYS = [
  "RATE_LIMIT_PROPOSAL_SUMMARY_MAX_REQUESTS",
  "RATE_LIMIT_PROPOSAL_SUMMARY_WINDOW_MS",
];

const loadRateLimitConfig = async () => {
  vi.resetModules();
  return (await import("@/config/rateLimit")).rateLimitConfig;
};

const cleanupEnv = () => {
  RATE_LIMIT_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
};

describe("rate limit config", () => {
  afterEach(() => {
    cleanupEnv();
  });

  it("falls back to defaults when invalid thresholds are provided", async () => {
    const baseline = (await loadRateLimitConfig()).proposalSummary;
    process.env.RATE_LIMIT_PROPOSAL_SUMMARY_MAX_REQUESTS = "0";
    process.env.RATE_LIMIT_PROPOSAL_SUMMARY_WINDOW_MS = "-100";

    const refreshed = (await loadRateLimitConfig()).proposalSummary;

    expect(refreshed.maxRequests).toBe(baseline.maxRequests);
    expect(refreshed.windowMs).toBe(baseline.windowMs);
  });

  it("applies positive overrides from the environment", async () => {
    process.env.RATE_LIMIT_PROPOSAL_SUMMARY_MAX_REQUESTS = "10";
    process.env.RATE_LIMIT_PROPOSAL_SUMMARY_WINDOW_MS = "120000";

    const overridden = (await loadRateLimitConfig()).proposalSummary;

    expect(overridden.maxRequests).toBe(10);
    expect(overridden.windowMs).toBe(120000);
  });
});
