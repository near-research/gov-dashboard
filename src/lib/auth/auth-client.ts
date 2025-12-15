import { createAuthClient } from "better-auth/react";
import { siwnClient } from "better-near-auth/client";
import { siwnDomain } from "@/config/siwn";
import { logger } from "@/lib/logger";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
  plugins: [
    siwnClient({
      domain: siwnDomain,
      networkId:
        (process.env.NEXT_PUBLIC_NEAR_NETWORK as "mainnet" | "testnet") ||
        "mainnet",
    }),
  ],
});

// Core exports
export const { signOut, useSession, getSession } = authClient;

// NEAR-specific helpers
export const getNearClient = () => authClient.near.getNearClient();
export const getAccountId = () => authClient.near.getAccountId();
export const disconnectNear = async (): Promise<void> => {
  try {
    await authClient.near.disconnect();
  } catch (error) {
    // Hot Connect iframe may already be destroyed - safe to ignore
  }
};

/**
 * Safe sign-out that handles NEAR disconnect before session clear
 */
export const safeSignOut = async (): Promise<void> => {
  try {
    await disconnectNear();
  } catch (disconnectError) {
    logger.error("NEAR disconnect during sign-out failed:", disconnectError);
  }
  await signOut();
};

export type AuthClient = typeof authClient;
