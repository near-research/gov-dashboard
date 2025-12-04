const normalizeMessage = (value: unknown) =>
  value?.toString?.().toLowerCase?.() ?? "";

const getErrorCode = (err: any) =>
  err?.code ?? err?.data?.code ?? err?.error?.code;

export const shouldRetryNonce = (err: any) => {
  const code = getErrorCode(err);
  const message = normalizeMessage(err?.message ?? err?.data?.message);
  const reason = normalizeMessage(err?.reason);
  return code === "NONCE_NOT_FOUND" || message.includes("nonce") || reason.includes("nonce");
};

export const isUserRejected = (err: any) => {
  const code = getErrorCode(err);
  const message = normalizeMessage(err?.message ?? err?.data?.message);
  const reason = normalizeMessage(err?.reason);
  return (
    code === "ACTION_REJECTED" ||
    code === 4001 ||
    message.includes("user rejected") ||
    message.includes("user cancelled") ||
    reason.includes("user rejected") ||
    reason.includes("user cancelled")
  );
};

const getBackoffDelay = (
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
) => Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

export const waitForBackoff = (
  attempt: number,
  baseDelayMs = 250,
  maxDelayMs = 2000
) =>
  new Promise<void>((resolve) => {
    const delay = getBackoffDelay(attempt, baseDelayMs, maxDelayMs);
    setTimeout(resolve, delay);
  });
