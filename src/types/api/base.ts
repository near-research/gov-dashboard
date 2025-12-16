/**
 * Base API response types shared across all endpoints
 */

// Base error shape for all API errors
export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

// Type guard for error responses
export function isApiError(response: unknown): response is ApiErrorResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    "error" in response &&
    typeof (response as ApiErrorResponse).error === "string"
  );
}
