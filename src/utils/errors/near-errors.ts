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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return "Something went wrong. Please try again.";
};

const getErrorCode = (error: unknown): string | number | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const candidate =
    record.code ??
    (record.data as Record<string, unknown> | undefined)?.code ??
    (record.error as Record<string, unknown> | undefined)?.code;
  return candidate as string | number | undefined;
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
