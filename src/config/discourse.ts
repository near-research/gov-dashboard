export const DISCOURSE_MAX_PER_PAGE = 30;
export const DISCOURSE_MIN_PER_PAGE = 1;
export const DISCOURSE_RENDER_LIMIT = 20;

export const DISCOURSE_PROPOSALS_CATEGORY_ID = Number(
  process.env.DISCOURSE_PROPOSALS_CATEGORY_ID || 5
);

export const clampPageSize = (value?: number | null) => {
  const normalized = value ?? DISCOURSE_MAX_PER_PAGE;
  return Math.min(
    Math.max(normalized, DISCOURSE_MIN_PER_PAGE),
    DISCOURSE_MAX_PER_PAGE
  );
};

export const clampRenderLimit = (value?: number | null) =>
  Math.min(clampPageSize(value), DISCOURSE_RENDER_LIMIT);
