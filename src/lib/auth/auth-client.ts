import { createAuthClient } from "better-auth/react";
import { siwnClient } from "better-near-auth/client";
import { siwnDomain } from "@/config/siwn";

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
export const disconnectNear = () => authClient.near.disconnect();

export type AuthClient = typeof authClient;
