/**
 * Authentication constants
 */

// Nonce expiration time (ms) - server uses 15 min, client checks at 14
export const NONCE_EXPIRY_MS = 15 * 60 * 1000;
export const NONCE_FRESHNESS_CHECK_MS = 14 * 60 * 1000;

// Session refresh interval (ms)
export const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
