import { logger } from "@/lib/logger";
/**
 * Standardized error types for NEAR wallet and signing operations.
 * Used across components that interact with wallets or signing flows.
 */

export type NearErrorCode =
  | "WALLET_DISCONNECTED"
  | "USER_REJECTED"
  | "NONCE_EXPIRED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export interface NearOperationError {
  code: NearErrorCode;
  message: string;
  originalError: unknown;
  retryable: boolean;
  action?: "reconnect" | "retry" | "refresh_nonce";
}

type ErrorPayload = Record<string, unknown>;

const parseJsonPayload = (value: string): ErrorPayload | null => {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as ErrorPayload;
    }
  } catch {
    /* ignore */
  }
  return null;
};

const getErrorRecordFromString = (error: unknown): ErrorPayload | null => {
  if (error instanceof Error && typeof error.message === "string") {
    const parsed = parseJsonPayload(error.message);
    if (parsed) {
      return parsed;
    }
  }
  if (typeof error === "string") {
    const parsed = parseJsonPayload(error);
    if (parsed) {
      return parsed;
    }
  }
  return null;
};

const getErrorRecord = (error: unknown): ErrorPayload | null => {
  const parsedPayload = getErrorRecordFromString(error);
  if (parsedPayload) {
    return parsedPayload;
  }
  if (error && typeof error === "object") {
    return error as ErrorPayload;
  }
  return null;
};

const extractMessageFromRecord = (record: ErrorPayload): string | null => {
  const messageCandidate = record.message ?? record.error ?? record.detail ?? record.description;
  if (typeof messageCandidate === "string" && messageCandidate.length > 0) {
    return messageCandidate;
  }
  const nested = record.json;
  if (nested && typeof nested === "object") {
    return extractMessageFromRecord(nested as ErrorPayload);
  }
  return null;
};

const extractCodeFromRecord = (record: ErrorPayload): string | number | undefined => {
  if (record.code !== undefined) {
    return record.code as string | number;
  }

  const data = record.data;
  if (data && typeof data === "object") {
    const dataRecord = data as ErrorPayload;
    if (dataRecord.code !== undefined) {
      return dataRecord.code as string | number;
    }
  }

  const errorField = record.error;
  if (errorField) {
    if (typeof errorField === "string") {
      return errorField;
    }
    if (typeof errorField === "object" && errorField !== null) {
      const errorRecord = errorField as ErrorPayload;
      if (errorRecord.code !== undefined) {
        return errorRecord.code as string | number;
      }
    }
  }

  const nested = record.json;
  if (nested && typeof nested === "object") {
    const nestedRecord = nested as ErrorPayload;
    if (nestedRecord.code !== undefined) {
      return nestedRecord.code as string | number;
    }
    if (typeof nestedRecord.error === "string") {
      return nestedRecord.error;
    }
  }

  return undefined;
};

const getErrorMessage = (error: unknown): string => {
  const record = getErrorRecord(error);
  if (record) {
    const structured = extractMessageFromRecord(record);
    if (structured) {
      return structured;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return "Something went wrong. Please try again.";
};

const getErrorCode = (error: unknown): string | number | undefined => {
  const record = getErrorRecord(error);
  if (record) {
    return extractCodeFromRecord(record);
  }
  return undefined;
};

export function createNearOperationError(error: unknown): NearOperationError {
  const rawMessage = getErrorMessage(error);
  const errorMessage = rawMessage.toLowerCase();
  const errorCode = getErrorCode(error);

  if (
    errorCode === "ACTION_REJECTED" ||
    errorCode === 4001 ||
    errorMessage.includes("user rejected") ||
    errorMessage.includes("user cancelled") ||
    errorMessage.includes("user denied") ||
    errorMessage.includes("signing failed") ||
    errorMessage.includes("rejected by user") ||
    errorMessage.includes("authorization failed") ||
    errorMessage.includes("user declined")
  ) {
    return {
      code: "USER_REJECTED",
      message: "Signing cancelled.",
      originalError: error,
      retryable: true,
      action: "retry",
    };
  }

  if (
    errorMessage.includes("wallet disconnected") ||
    errorMessage.includes("no wallet") ||
    errorMessage.includes("wallet not connected") ||
    errorMessage.includes("no key found")
  ) {
    return {
      code: "WALLET_DISCONNECTED",
      message: "Wallet disconnected. Please reconnect your wallet.",
      originalError: error,
      retryable: true,
      action: "reconnect",
    };
  }

  if (
    errorMessage.includes("nonce") ||
    errorMessage.includes("expired") ||
    errorMessage.includes("invalid session")
  ) {
    return {
      code: "NONCE_EXPIRED",
      message: "Session expired. Please try again.",
      originalError: error,
      retryable: true,
      action: "refresh_nonce",
    };
  }

  if (
    errorMessage.includes("network") ||
    errorMessage.includes("fetch") ||
    errorMessage.includes("timeout") ||
    errorMessage.includes("econnrefused")
  ) {
    const networkFriendlyMessage =
      "Network error. Please check your connection and try again.";
    const messageToShow =
      rawMessage === "Something went wrong. Please try again."
        ? networkFriendlyMessage
        : rawMessage;
    return {
      code: "NETWORK_ERROR",
      message: messageToShow,
      originalError: error,
      retryable: true,
      action: "retry",
    };
  }

  return {
    code: "UNKNOWN",
    message: getErrorMessage(error),
    originalError: error,
    retryable: true,
    action: "retry",
  };
}

/**
 * Logs a NEAR operation error with consistent structure.
 */
export function logNearError(
  operationName: string,
  error: NearOperationError
): void {
  logger.error(`[${operationName}] NEAR operation failed:`, {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    action: error.action,
    originalError: error.originalError,
  });
}
