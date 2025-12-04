const isProd = process.env.NODE_ENV === "production";

const DEFAULT_PROD_DISCOURSE = "https://gov.near.org";
const DEFAULT_NON_PROD_DISCOURSE = "https://discuss.near.vote";

const resolvedDiscourse =
  process.env.NEXT_PUBLIC_DISCOURSE_URL ||
  process.env.DISCOURSE_URL ||
  (isProd ? DEFAULT_PROD_DISCOURSE : DEFAULT_NON_PROD_DISCOURSE);

if (!process.env.NEXT_PUBLIC_DISCOURSE_URL && !process.env.DISCOURSE_URL) {
  console.warn(
    `[Config] Using default Discourse endpoint (${
      isProd ? DEFAULT_PROD_DISCOURSE : DEFAULT_NON_PROD_DISCOURSE
    }). Set NEXT_PUBLIC_DISCOURSE_URL or DISCOURSE_URL to point at your environment.`
  );
}

export const servicesConfig = {
  discourseUrl: resolvedDiscourse.replace(/\/$/, ""),
};
