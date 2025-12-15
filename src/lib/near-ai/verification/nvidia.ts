import { decodeJwt } from "jose";

const NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";
const DEFAULT_TIMEOUT = 10000;

export interface NvidiaAttestationResult {
  verified: boolean;
  overallResult: boolean;
  claims?: Record<string, unknown>;
  raw?: unknown;
  error?: string;
}

export interface NvidiaVerifyOptions {
  url?: string;
  timeout?: number;
}

const isJwt = (token: string): boolean => token.includes(".");

export async function verifyNvidiaPayload(
  payload: string,
  options?: NvidiaVerifyOptions
): Promise<NvidiaAttestationResult> {
  const url = options?.url || NRAS_URL;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: payload,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        verified: false,
        overallResult: false,
        error: `NVIDIA attestation request failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    const decoded = decodeNvidiaResponse(data);
    const overallResult = Boolean(
      decoded.claims?.["x-nvidia-overall-att-result"]
    );

    return {
      verified: overallResult,
      overallResult,
      claims: decoded.claims,
      raw: data,
      error: overallResult ? undefined : "NVIDIA overall attestation result is false",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        verified: false,
        overallResult: false,
        error: `NVIDIA attestation request timed out after ${timeout}ms`,
      };
    }

    return {
      verified: false,
      overallResult: false,
      error:
        error instanceof Error
          ? error.message
          : "NVIDIA attestation verification failed",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function decodeNvidiaResponse(response: unknown): {
  claims?: Record<string, unknown>;
  error?: string;
} {
  if (!Array.isArray(response)) {
    return { error: "Expected array response from NVIDIA attestation service" };
  }

  const claims: Record<string, unknown> = {};

  const decodeToken = (key: string, token: string) => {
    if (!isJwt(token)) return;
    try {
      const decoded = decodeJwt(token);
      claims[key] = decoded;
      if (key === "JWT") {
        Object.assign(claims, decoded);
      }
    } catch {
      // Skip malformed tokens
    }
  };

  for (const item of response) {
    if (Array.isArray(item) && item.length === 2) {
      const [key, token] = item;
      if (typeof key === "string" && typeof token === "string") {
        decodeToken(key, token);
      }
      continue;
    }

    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      for (const [key, token] of Object.entries(item)) {
        if (typeof token === "string") {
          decodeToken(key, token);
        }
      }
    }
  }

  return { claims };
}

export async function verifyNvidiaPayloads(
  payloads: string[],
  options?: NvidiaVerifyOptions
): Promise<{ allPassed: boolean; results: NvidiaAttestationResult[] }> {
  const results: NvidiaAttestationResult[] = [];

  for (const payload of payloads) {
    const result = await verifyNvidiaPayload(payload, options);
    results.push(result);
  }

  const allPassed = results.every((result) => result.verified);

  return { allPassed, results };
}
