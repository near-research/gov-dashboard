/**
 * Extract hostname from URL, stripping protocol but keeping port for localhost
 */
function getDomainFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url;
  }
}

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

/**
 * Domain for SIWN flows.
 * Explicit NEXT_PUBLIC_NEAR_DOMAIN overrides, otherwise derived from BASE_URL.
 */
export const siwnDomain =
  process.env.NEXT_PUBLIC_NEAR_DOMAIN || getDomainFromUrl(baseUrl);

/**
 * Recipient for server-side verification.
 * Should match siwnDomain unless explicitly overridden.
 */
export const siwnRecipient = process.env.NEAR_RECIPIENT || siwnDomain;
