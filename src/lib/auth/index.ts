import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { siwn } from "better-near-auth";
import { db } from "@/lib/db";
import * as authSchema from "@/lib/db/schema";
import { siwnRecipient } from "@/config/siwn";

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required");
}

const fallbackAppUrl = "http://localhost:3000";
const canonicalAppUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  process.env.BETTER_AUTH_URL ||
  fallbackAppUrl;
const trustedOrigins = Array.from(
  new Set([fallbackAppUrl, canonicalAppUrl])
);

if (process.env.NODE_ENV !== "production") {
  console.debug("[better-auth] trusted origins:", trustedOrigins.join(", "));
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),

  trustedOrigins,

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: canonicalAppUrl,

  plugins: [
    siwn({
      recipient: siwnRecipient,
      anonymous: true,
      requireFullAccessKey: false,
    }),
  ],

  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      trustedProviders: ["siwn"],
      updateUserInfoOnLink: true,
    },
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    },
  },
});

export type Auth = typeof auth;
