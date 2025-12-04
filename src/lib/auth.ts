import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { siwn } from "better-near-auth";
import { db } from "./db";
import * as authSchema from "./db/schema";
import { siwnRecipient } from "@/config/siwn";

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required");
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),

  trustedOrigins: [process.env.BETTER_AUTH_URL || "http://localhost:3000"],

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",

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
