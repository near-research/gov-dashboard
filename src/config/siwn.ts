const defaultDomain = process.env.NEXT_PUBLIC_NEAR_DOMAIN || "gov.near.org";

/**
 * Recipient/domain for SIWN flows.
 * - Client: used in better-near-auth client plugin and sign-in calls.
 * - Server: used by better-near-auth verification.
 */
export const siwnRecipient =
  process.env.NEAR_RECIPIENT || defaultDomain;

/**
 * Domain passed to the SIWN client plugin; kept separate for clarity even though
 * it currently mirrors the recipient.
 */
export const siwnDomain = defaultDomain;
