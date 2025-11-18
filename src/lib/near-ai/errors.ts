/**
 * NEAR AI Client Error Classes
 */

export class NearAIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "NearAIError";
  }
}

export class NearAITimeoutError extends NearAIError {
  constructor(message = "Request timeout") {
    super(message, 504);
    this.name = "NearAITimeoutError";
  }
}

export class NearAIConfigurationError extends NearAIError {
  constructor(message = "NEAR AI API not configured") {
    super(message, 500);
    this.name = "NearAIConfigurationError";
  }
}

