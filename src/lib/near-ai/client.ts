/**
 * NEAR AI Cloud API Client
 *
 * Centralized client for making requests to NEAR AI Cloud API.
 * Handles authentication, error handling, streaming, and timeouts.
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionOptions,
} from "./types";
import { NearAIError, NearAITimeoutError, NearAIConfigurationError } from "./errors";
import { randomUUID } from "crypto";
import { buildVerificationHeaders } from "@/lib/verification/near-ai";

const DEFAULT_BASE_URL = "https://cloud-api.near.ai";
const DEFAULT_TIMEOUT = 120000; // 2 minutes

export class NearAIClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultTimeout: number;
  private readonly defaults: Required<
    Pick<ChatCompletionOptions, "retryAttempts" | "retryBaseDelayMs">
  > &
    Partial<Pick<ChatCompletionOptions, "verificationId" | "verificationNonce">>;

  constructor(options: ChatCompletionOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = options.apiKey ?? process.env.NEAR_AI_CLOUD_API_KEY;
    this.defaultTimeout = options.timeout || DEFAULT_TIMEOUT;
    this.defaults = {
      retryAttempts: options.retryAttempts ?? 0,
      retryBaseDelayMs: options.retryBaseDelayMs ?? 100,
      verificationId: options.verificationId,
      verificationNonce: options.verificationNonce,
    };
  }

  private resolveApiKey(options?: ChatCompletionOptions): string {
    const key = options?.apiKey ?? this.apiKey;
    if (!key) {
      throw new NearAIConfigurationError(
        "NEAR_AI_CLOUD_API_KEY environment variable is not set"
      );
    }
    return key;
  }

  /**
   * Create a chat completion (non-streaming)
   */
  async chatCompletions(
    request: ChatCompletionRequest,
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    const mergedOptions = { ...this.defaults, ...options };
    const apiKey = this.resolveApiKey(mergedOptions);
    const retries = mergedOptions.retryAttempts ?? 0;
    const baseDelay = mergedOptions.retryBaseDelayMs ?? 100;
    const requestId = mergedOptions.requestId || randomUUID();

    const doAttempt = async (attempt: number): Promise<ChatCompletionResponse> => {
      const timeout = mergedOptions.timeout ?? this.defaultTimeout;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const verificationHeaders = buildVerificationHeaders({
        verificationId: mergedOptions.verificationId ?? mergedOptions.verification?.verificationId,
        verificationNonce:
          mergedOptions.verificationNonce ??
          mergedOptions.verification?.verificationNonce,
        requestHash: mergedOptions.verification?.requestHash,
        responseHash: mergedOptions.verification?.responseHash,
        signingAlgo: mergedOptions.verification?.signingAlgo,
        extraHeaders: mergedOptions.verification?.extraHeaders,
      });
      const headers: HeadersInit = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        ...verificationHeaders,
      };

      try {
        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...request,
            stream: false,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          let errorDetails: unknown = errorText;

          try {
            const errorJson = JSON.parse(errorText);
            errorDetails = errorJson.error || errorJson.message || errorText;
          } catch {
            // Keep original text if not JSON
          }

          throw new NearAIError(
            `NEAR AI API error: ${response.status}`,
            response.status,
            errorDetails
          );
        }

        const data = await response.json();
        return data as ChatCompletionResponse;
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === "AbortError") {
          throw new NearAITimeoutError(
            `Request timeout after ${timeout}ms`
          );
        }

        if (error instanceof NearAIError) {
          throw error;
        }

        throw new NearAIError(
          error instanceof Error ? error.message : "Unknown error occurred",
          undefined,
          error
        );
      }
    };

    let attempt = 0;
    let lastError: unknown;
    while (attempt <= retries) {
      try {
        return await doAttempt(attempt);
      } catch (error) {
        lastError = error;
        if (attempt >= retries || error instanceof NearAITimeoutError) {
          throw error;
        }
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt += 1;
      }
    }

    throw lastError instanceof Error ? lastError : new NearAIError("Unknown error occurred");
  }

  /**
   * Create a chat completion (streaming)
   * Returns the raw Response object for streaming
   */
  async chatCompletionsStream(
    request: ChatCompletionRequest | string,
    options?: ChatCompletionOptions
  ): Promise<Response> {
    const mergedOptions = { ...this.defaults, ...options };
    const timeout = mergedOptions.timeout ?? this.defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const apiKey = this.resolveApiKey(mergedOptions);

    try {
      const verificationHeaders = buildVerificationHeaders({
        verificationId: mergedOptions.verificationId ?? mergedOptions.verification?.verificationId,
        verificationNonce:
          mergedOptions.verificationNonce ??
          mergedOptions.verification?.verificationNonce,
        requestHash: mergedOptions.verification?.requestHash,
        responseHash: mergedOptions.verification?.responseHash,
        signingAlgo: mergedOptions.verification?.signingAlgo,
        extraHeaders: mergedOptions.verification?.extraHeaders,
      });
      const headers: HeadersInit = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...verificationHeaders,
      };

      const bodyString =
        typeof request === "string"
          ? request
          : JSON.stringify({
              ...request,
              stream: true, // Ensure streaming
            });

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: bodyString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetails: unknown = errorText;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorDetails = errorJson.error || errorJson.message || errorText;
        } catch {
          // Keep original text if not JSON
        }

        throw new NearAIError(
          `NEAR AI API error: ${response.status}`,
          response.status,
          errorDetails
        );
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new NearAITimeoutError(
          `Request timeout after ${timeout}ms`
        );
      }

      if (error instanceof NearAIError) {
        throw error;
      }

      throw new NearAIError(
        error instanceof Error ? error.message : "Unknown error occurred",
        undefined,
        error
      );
    }
  }

  /**
   * Get the API key (useful for checking if configured)
   */
  getApiKey(): string {
    return this.apiKey || "";
  }

  /**
   * Check if API is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Expose the active configuration for diagnostics and tests.
   */
  getConfig(): { baseUrl: string; apiKey?: string; timeout: number } {
    return {
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      timeout: this.defaultTimeout,
    };
  }
}

/**
 * Default singleton instance
 */
let defaultClient: NearAIClient | null = null;
let defaultClientConfig: ChatCompletionOptions | undefined;

const normalizeConfig = (
  options?: ChatCompletionOptions
): ChatCompletionOptions | undefined => {
  if (!options) return undefined;
  const normalized: ChatCompletionOptions = {};
  if (typeof options.apiKey !== "undefined") normalized.apiKey = options.apiKey;
  if (typeof options.baseUrl !== "undefined")
    normalized.baseUrl = options.baseUrl;
  if (typeof options.timeout !== "undefined") normalized.timeout = options.timeout;
  if (typeof options.retryAttempts !== "undefined")
    normalized.retryAttempts = options.retryAttempts;
  if (typeof options.retryBaseDelayMs !== "undefined")
    normalized.retryBaseDelayMs = options.retryBaseDelayMs;
  return normalized;
};

const hasConfigChanged = (
  prev?: ChatCompletionOptions,
  next?: ChatCompletionOptions
) => {
  if (!prev && !next) return false;
  if (!prev || !next) return true;
  return (
    prev.apiKey !== next.apiKey ||
    prev.baseUrl !== next.baseUrl ||
    prev.timeout !== next.timeout ||
    prev.retryAttempts !== next.retryAttempts ||
    prev.retryBaseDelayMs !== next.retryBaseDelayMs
  );
};

/**
 * Get or create the default NEAR AI client instance
 */
export function getNearAIClient(options?: ChatCompletionOptions): NearAIClient {
  if (!defaultClient) {
    defaultClientConfig = normalizeConfig(options);
    defaultClient = new NearAIClient(defaultClientConfig);
  } else if (options) {
    const currentConfig = defaultClientConfig ?? defaultClient?.getConfig();
    const nextConfig = {
      ...(currentConfig || {}),
      ...normalizeConfig(options),
    };
    if (hasConfigChanged(defaultClientConfig, nextConfig)) {
      defaultClientConfig = nextConfig;
      defaultClient = new NearAIClient(nextConfig);
    }
  }
  return defaultClient;
}

/**
 * Create a new NEAR AI client instance
 */
export function createNearAIClient(options?: ChatCompletionOptions): NearAIClient {
  return new NearAIClient(options);
}

/**
 * Reset the shared singleton, optionally with new configuration.
 */
export function resetNearAIClient(
  options?: ChatCompletionOptions
): NearAIClient | null {
  defaultClientConfig = normalizeConfig(options);
  defaultClient = options ? new NearAIClient(defaultClientConfig) : null;
  return defaultClient;
}
