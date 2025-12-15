const normalizeMessage = (value: unknown) =>
  value?.toString?.().toLowerCase?.() ?? "";

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const getNestedRecord = (
  record: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null => toRecord(record?.[key]);

const getErrorCode = (err: unknown): string | number | undefined => {
  const record = toRecord(err);
  if (!record) return undefined;
  const code =
    record.code ??
    getNestedRecord(record, "data")?.code ??
    getNestedRecord(record, "error")?.code;

  if (typeof code === "string" || typeof code === "number") {
    return code;
  }
  return undefined;
};

const getPrimaryMessage = (err: unknown): unknown => {
  const record = toRecord(err);
  if (!record) return undefined;
  const dataRecord = getNestedRecord(record, "data");
  return record.message ?? dataRecord?.message;
};

const getReasonMessage = (err: unknown): unknown => {
  const record = toRecord(err);
  if (!record) return undefined;
  return record.reason ?? getNestedRecord(record, "data")?.reason;
};

export const shouldRetryNonce = (err: unknown) => {
  const code = getErrorCode(err);
  const message = normalizeMessage(getPrimaryMessage(err));
  const reason = normalizeMessage(getReasonMessage(err));
  return (
    code === "NONCE_NOT_FOUND" ||
    message.includes("nonce") ||
    reason.includes("nonce")
  );
};

export const isUserRejected = (err: unknown) => {
  const code = getErrorCode(err);
  const message = normalizeMessage(getPrimaryMessage(err));
  const reason = normalizeMessage(getReasonMessage(err));
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
