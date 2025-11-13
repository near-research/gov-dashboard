/**
 * Utility helpers for building consistent rate-limit messages from API
 * responses. Works on both Request/Response headers and JSON payloads that
 * include a `retryAfter` field (in seconds).
 */

const DEFAULT_RETRY_AFTER_SECONDS = 15 * 60; // 15 minutes

function coerceSeconds(value?: number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return null;
}

export function deriveRetryAfterSeconds(
  response?: Response,
  bodyRetryAfter?: number | null,
  fallbackSeconds: number = DEFAULT_RETRY_AFTER_SECONDS
): number {
  const fromBody = coerceSeconds(bodyRetryAfter);
  if (fromBody !== null) {
    return fromBody;
  }

  const header = response?.headers?.get("Retry-After");
  if (header) {
    const parsed = parseInt(header, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallbackSeconds;
}

export interface RateLimitInfo {
  remaining: number | null;
  limit: number | null;
  resetSeconds: number | null;
}

export function extractRateLimitInfo(response?: Response): RateLimitInfo {
  const remainingHeader = response?.headers?.get("X-RateLimit-Remaining");
  const limitHeader = response?.headers?.get("X-RateLimit-Limit");
  const resetHeader = response?.headers?.get("X-RateLimit-Reset");

  const parse = (value?: string | null): number | null => {
    if (!value) return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  return {
    remaining: parse(remainingHeader),
    limit: parse(limitHeader),
    resetSeconds: parse(resetHeader),
  };
}

export function formatRateLimitMessage(seconds?: number): string {
  const targetSeconds =
    typeof seconds === "number" && seconds > 0
      ? seconds
      : DEFAULT_RETRY_AFTER_SECONDS;
  const minutes = Math.max(1, Math.ceil(targetSeconds / 60));
  return `Rate limit exceeded. Please try again in ${minutes} minute${
    minutes === 1 ? "" : "s"
  }.`;
}

export function buildRateLimitMessage(
  response?: Response,
  bodyRetryAfter?: number | null,
  fallbackSeconds?: number
): string {
  const seconds = deriveRetryAfterSeconds(
    response,
    bodyRetryAfter,
    fallbackSeconds
  );
  return formatRateLimitMessage(seconds);
}
