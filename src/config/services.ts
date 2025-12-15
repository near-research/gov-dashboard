import { logger } from "@/lib/logger";
import { DISCOURSE_URLS, NEAR_AI_URLS } from "@/constants/services";

const isProd = process.env.NODE_ENV === "production";

const resolvedDiscourse =
  process.env.NEXT_PUBLIC_DISCOURSE_URL ||
  process.env.DISCOURSE_URL ||
  (isProd ? DISCOURSE_URLS.PRODUCTION : DISCOURSE_URLS.FORUM);

if (!process.env.NEXT_PUBLIC_DISCOURSE_URL && !process.env.DISCOURSE_URL) {
  logger.warn(
    `[Config] Using default Discourse endpoint (${
      isProd ? DISCOURSE_URLS.PRODUCTION : DISCOURSE_URLS.FORUM
    }). Set NEXT_PUBLIC_DISCOURSE_URL or DISCOURSE_URL to point at your environment.`
  );
}

export type ServicesConfig = {
  discourseBaseUrl: string;
  nearAI?: {
    baseUrl: string;
  };
};

export const servicesConfig: ServicesConfig = {
  discourseBaseUrl: resolvedDiscourse.replace(/\/$/, ""),
  nearAI: {
    baseUrl: (process.env.NEAR_AI_URL || NEAR_AI_URLS.PRODUCTION).replace(
      /\/$/,
      ""
    ),
  },
};
