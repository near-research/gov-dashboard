import { createAuthClient } from "better-auth/react";
import { siwnClient } from "better-near-auth/client";
import { siwnDomain, siwnRecipient } from "@/config/siwn";

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

export const { signIn, signOut, useSession, getSession } = authClient;
export type AuthClient = typeof authClient;
