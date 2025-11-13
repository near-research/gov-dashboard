type EndpointKey =
  | "evaluateDraft"
  | "screen"
  | "proposalSummary"
  | "proposalRevisions"
  | "discussionSummary"
  | "replySummary"
  | "postRevisions";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const DEFAULT_WINDOW_MS = parseNumberFromEnv(
  "RATE_LIMIT_DEFAULT_WINDOW_MS",
  15 * 60 * 1000
);
const DEFAULT_MAX_REQUESTS = parseNumberFromEnv(
  "RATE_LIMIT_DEFAULT_MAX_REQUESTS",
  5
);

function parseNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function buildConfig(suffix: string): RateLimitConfig {
  return {
    windowMs: parseNumberFromEnv(
      `RATE_LIMIT_${suffix}_WINDOW_MS`,
      DEFAULT_WINDOW_MS
    ),
    maxRequests: parseNumberFromEnv(
      `RATE_LIMIT_${suffix}_MAX_REQUESTS`,
      DEFAULT_MAX_REQUESTS
    ),
  };
}

export const rateLimitConfig: Record<EndpointKey, RateLimitConfig> = {
  evaluateDraft: buildConfig("EVALUATE_DRAFT"),
  screen: buildConfig("SCREEN"),
  proposalSummary: buildConfig("PROPOSAL_SUMMARY"),
  proposalRevisions: buildConfig("PROPOSAL_REVISIONS"),
  discussionSummary: buildConfig("DISCUSSION_SUMMARY"),
  replySummary: buildConfig("REPLY_SUMMARY"),
  postRevisions: buildConfig("POST_REVISIONS"),
};
