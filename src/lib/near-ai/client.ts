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

const DEFAULT_BASE_URL = "https://cloud-api.near.ai";
const DEFAULT_TIMEOUT = 120000; // 2 minutes

export class NearAIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultTimeout: number;

  constructor(options: ChatCompletionOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = options.apiKey || process.env.NEAR_AI_CLOUD_API_KEY || "";
    this.defaultTimeout = options.timeout || DEFAULT_TIMEOUT;

    if (!this.apiKey) {
      throw new NearAIConfigurationError(
        "NEAR_AI_CLOUD_API_KEY environment variable is not set"
      );
    }
  }

  /**
   * Create a chat completion (non-streaming)
   */
  async chatCompletions(
    request: ChatCompletionRequest,
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    const timeout = options?.timeout || this.defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: HeadersInit = {
        Authorization: `Bearer ${options?.apiKey || this.apiKey}`,
        "Content-Type": "application/json",
      };

      // Add verification headers if provided
      if (options?.verificationId) {
        headers["X-Verification-Id"] = options.verificationId;
      }
      if (options?.verificationNonce) {
        headers["X-Nonce"] = options.verificationNonce;
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...request,
          stream: false, // Ensure non-streaming
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
  }

  /**
   * Create a chat completion (streaming)
   * Returns the raw Response object for streaming
   */
  async chatCompletionsStream(
    request: ChatCompletionRequest,
    options?: ChatCompletionOptions
  ): Promise<Response> {
    const timeout = options?.timeout || this.defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: HeadersInit = {
        Authorization: `Bearer ${options?.apiKey || this.apiKey}`,
        "Content-Type": "application/json",
      };

      // Add verification headers if provided
      if (options?.verificationId) {
        headers["X-Verification-Id"] = options.verificationId;
      }
      if (options?.verificationNonce) {
        headers["X-Nonce"] = options.verificationNonce;
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...request,
          stream: true, // Ensure streaming
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
    return this.apiKey;
  }

  /**
   * Check if API is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

/**
 * Default singleton instance
 */
let defaultClient: NearAIClient | null = null;

/**
 * Get or create the default NEAR AI client instance
 */
export function getNearAIClient(options?: ChatCompletionOptions): NearAIClient {
  if (!defaultClient) {
    defaultClient = new NearAIClient(options);
  }
  return defaultClient;
}

/**
 * Create a new NEAR AI client instance
 */
export function createNearAIClient(options?: ChatCompletionOptions): NearAIClient {
  return new NearAIClient(options);
}

