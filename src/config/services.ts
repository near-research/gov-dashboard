import { DISCOURSE_URLS, NEAR_AI_URLS } from "@/constants/services";

const discourseUrl =
  process.env.NEXT_PUBLIC_DISCOURSE_URL || process.env.DISCOURSE_URL;

if (!discourseUrl) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DISCOURSE_URL or NEXT_PUBLIC_DISCOURSE_URL must be set in production"
    );
  }

  // Development/test fallback with warning
  console.warn(
    "[Config] Using default Discourse endpoint. Set NEXT_PUBLIC_DISCOURSE_URL or DISCOURSE_URL."
  );
}

export type ServicesConfig = {
  discourseBaseUrl: string;
  nearAI?: {
    baseUrl: string;
  };
};

export const DISCOURSE_URL = discourseUrl || DISCOURSE_URLS.FORUM;

export const servicesConfig: ServicesConfig = {
  discourseBaseUrl: DISCOURSE_URL.replace(/\/$/, ""),
  nearAI: {
    baseUrl: (process.env.NEAR_AI_URL || NEAR_AI_URLS.PRODUCTION).replace(
      /\/$/,
      ""
    ),
  },
};
