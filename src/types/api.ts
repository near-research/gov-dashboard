export interface ApiErrorResponse {
  error: string;
  message?: string;
  status?: number;
  retryAfter?: number;
  details?: string;
  cacheAge?: number;
}
