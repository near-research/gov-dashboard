import type { NextApiResponse } from "next";

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export class ApiError extends Error {
  constructor(
    public code: keyof typeof ErrorCodes | (typeof ErrorCodes)[keyof typeof ErrorCodes],
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function respondWithError(
  res: NextApiResponse,
  error: ApiError | Error
) {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(ErrorCodes.INTERNAL_ERROR, error.message || "Internal error");

  const payload: Record<string, unknown> = {
    error: apiError.code,
    message: apiError.message,
    statusCode: apiError.statusCode,
  };

  if (
    process.env.NODE_ENV === "development" &&
    apiError.details !== undefined
  ) {
    payload.details = apiError.details;
  }

  return res.status(apiError.statusCode).json(payload);
}
