import "server-only";

const DEFAULT_DISCOURSE_BASE_URL = "https://gov.near.org";

export const normalizeFileSchemeUrl = (rawUrl: string) => {
  const normalized = rawUrl.trim();
  if (!normalized.toLowerCase().startsWith("file://")) {
    return normalized;
  }
  if (normalized.toLowerCase().startsWith("file:///")) {
    return normalized;
  }
  return `file:///${normalized.slice("file://".length)}`;
};

export const getDiscourseBaseUrl = () =>
  normalizeFileSchemeUrl(process.env.DISCOURSE_URL || DEFAULT_DISCOURSE_BASE_URL);
