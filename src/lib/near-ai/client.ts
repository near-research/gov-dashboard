/**
 * NEAR AI Cloud API Client
 *
 * Minimal wrapper for requesting chat completions.
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionOptions,
} from "./types";
import { NearAIError, NearAITimeoutError, NearAIConfigurationError } from "./errors";
import { randomUUID } from "crypto";

const DEFAULT_BASE_URL = "https://cloud-api.near.ai";
const DEFAULT_TIMEOUT = 120000; // 2 minutes

export class NearAIClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultTimeout: number;
  private readonly defaults: Required<
    Pick<ChatCompletionOptions, "retryAttempts" | "retryBaseDelayMs">
  >;

  constructor(options: ChatCompletionOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = options.apiKey ?? process.env.NEAR_AI_CLOUD_API_KEY;
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.defaults = {
      retryAttempts: options.retryAttempts ?? 0,
      retryBaseDelayMs: options.retryBaseDelayMs ?? 100,
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

  private buildHeaders(apiKey: string, requestId: string): HeadersInit {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    };
  }

  async chatCompletions(
    request: ChatCompletionRequest,
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    const mergedOptions = { ...this.defaults, ...options };
    const apiKey = this.resolveApiKey(mergedOptions);
    const retries = mergedOptions.retryAttempts;
    const baseDelay = mergedOptions.retryBaseDelayMs;
    const requestId = mergedOptions.requestId || randomUUID();

    const doAttempt = async (): Promise<ChatCompletionResponse> => {
      const timeout = mergedOptions.timeout ?? this.defaultTimeout;
      const headers = this.buildHeaders(apiKey, requestId);

      try {
        const response = await fetchWithTimeout(
          `${this.baseUrl}/v1/chat/completions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              ...request,
              stream: false,
            }),
          },
          timeout
        );

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
        if (error instanceof Error && error.name === "AbortError") {
          throw new NearAITimeoutError(`Request timeout after ${timeout}ms`);
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
        return await doAttempt();
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

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new NearAIError("Unknown error occurred");
  }

  async chatCompletionsStream(
    request: ChatCompletionRequest | string,
    options?: ChatCompletionOptions
  ): Promise<Response> {
    const mergedOptions = { ...this.defaults, ...options };
    const timeout = mergedOptions.timeout ?? this.defaultTimeout;
    const apiKey = this.resolveApiKey(mergedOptions);
    const headers = this.buildHeaders(
      apiKey,
      mergedOptions.requestId ?? randomUUID()
    );

    try {
      const bodyString =
        typeof request === "string"
          ? request
          : JSON.stringify({
              ...request,
              stream: true,
            });

      const response = await fetchWithTimeout(
        `${this.baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers,
          body: bodyString,
        },
        timeout
      );

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
      if (error instanceof Error && error.name === "AbortError") {
        throw new NearAITimeoutError(`Request timeout after ${timeout}ms`);
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

  getApiKey(): string {
    return this.apiKey ?? "";
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getConfig(): { baseUrl: string; apiKey?: string; timeout: number } {
    return {
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      timeout: this.defaultTimeout,
    };
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: HeadersInit = {
      Accept: "application/json",
      ...init.headers,
    };

    return await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

let sharedClient: NearAIClient | null = null;
let sharedClientOptions: ChatCompletionOptions | undefined;

export function createNearAIClient(options?: ChatCompletionOptions): NearAIClient {
  return new NearAIClient(options);
}

export function getNearAIClient(options?: ChatCompletionOptions): NearAIClient {
  if (!sharedClient) {
    sharedClientOptions = options;
    sharedClient = createNearAIClient(options);
    return sharedClient;
  }

  if (options) {
    const mergedOptions = {
      ...(sharedClientOptions ?? {}),
      ...options,
    };
    sharedClientOptions = mergedOptions;
    sharedClient = createNearAIClient(mergedOptions);
  }

  return sharedClient;
}

export function resetNearAIClient(): void {
  sharedClient = null;
  sharedClientOptions = undefined;
}
