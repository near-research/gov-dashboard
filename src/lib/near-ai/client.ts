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
import {
  chatCompletionResponseSchema,
  nearAIErrorResponseSchema,
} from "./schemas";
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
        const body =
          options?.serializedBody ??
          JSON.stringify({
            ...request,
            stream: false,
          });

        const response = await fetchWithTimeout(
          `${this.baseUrl}/v1/chat/completions`,
          {
            method: "POST",
            headers,
            body,
          },
          timeout
        );

        const { payload, rawText } = await parseResponseBody(response);

        if (!response.ok) {
        if (payload !== undefined) {
          const apiErrorResult = nearAIErrorResponseSchema.safeParse(payload);
          if (apiErrorResult.success) {
            throw new NearAIError(
              `NEAR AI API error: ${apiErrorResult.data.error.message}`,
              response.status,
              apiErrorResult.data.error
            );
          }
        }

        throw new NearAIError(
          `NEAR AI API error: ${response.status}`,
          response.status,
          payload ?? rawText ?? `HTTP ${response.status}`
        );
        }

        if (payload === undefined) {
          const preview = formatPayloadPreview(payload, rawText);
          console.error("NEAR AI response validation failed:", {
            status: response.status,
            errors: [],
            payload: preview,
          });

          throw new NearAIError(
            "NEAR AI returned an unexpected response format",
            response.status,
            {
              validationErrors: "Response could not be parsed as JSON",
              payload: preview,
            }
          );
        }

        const errorResult = nearAIErrorResponseSchema.safeParse(payload);
        if (errorResult.success) {
          const { message: errorMessage, type, code } = errorResult.data.error;
          throw new NearAIError(
            `NEAR AI API error: ${errorMessage}`,
            response.status,
            { message: errorMessage, type, code }
          );
        }

        const result = chatCompletionResponseSchema.safeParse(payload);
        if (!result.success) {
          const preview = formatPayloadPreview(payload, rawText);
          console.error("NEAR AI response validation failed:", {
            status: response.status,
            errors: result.error.flatten(),
            payload: preview,
          });

          throw new NearAIError(
            "NEAR AI returned an unexpected response format",
            response.status,
            {
              validationErrors: result.error.flatten(),
              payload: preview,
            }
          );
        }

        return result.data;
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
      const body =
        typeof request === "string"
          ? request
          : options?.serializedBody ??
            JSON.stringify({
              ...request,
              stream: true,
            });

      const response = await fetchWithTimeout(
        `${this.baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers,
          body,
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

type ParsedResponseBody = {
  payload?: unknown;
  rawText?: string;
};

async function parseResponseBody(response: Response): Promise<ParsedResponseBody> {
  try {
    return { payload: await response.clone().json() };
  } catch {
    return { rawText: await response.text() };
  }
}

function formatPayloadPreview(
  payload?: unknown,
  rawText?: string
): string {
  const source = payload ?? rawText ?? "";
  const asString =
    typeof source === "string"
      ? source
      : (() => {
          try {
            return JSON.stringify(source);
          } catch {
            return String(source);
          }
        })();
  return asString.slice(0, 500);
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
