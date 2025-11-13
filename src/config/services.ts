const isProd = process.env.NODE_ENV === "production";

const DEFAULT_PROD_DISCOURSE = "https://gov.near.org";
const DEFAULT_STAGING_DISCOURSE = "https://gov.near.org";
const DEFAULT_DEV_DISCOURSE = "https://discuss.near.vote";

const resolvedDiscourse =
  process.env.NEXT_PUBLIC_DISCOURSE_URL ||
  process.env.DISCOURSE_URL ||
  (isProd ? DEFAULT_PROD_DISCOURSE : DEFAULT_STAGING_DISCOURSE);

if (
  !isProd &&
  !process.env.NEXT_PUBLIC_DISCOURSE_URL &&
  !process.env.DISCOURSE_URL
) {
  console.warn(
    `[Config] Using default development Discourse endpoint (${DEFAULT_STAGING_DISCOURSE}). Set NEXT_PUBLIC_DISCOURSE_URL to match your staging instance.`
  );
}

export const servicesConfig = {
  discourseBaseUrl: resolvedDiscourse.replace(/\/$/, ""),
};
