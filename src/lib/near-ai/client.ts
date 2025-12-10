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
} from "@/types/near-ai";
import { NearAIError, NearAITimeoutError, NearAIConfigurationError } from "./errors";
import { randomUUID } from "crypto";
import * as jose from "jose";
import { verifyMessage } from "ethers";
import { extractHashesFromSignedText } from "@/verification/hash-utils";
import { normalizeSignaturePayload } from "@/verification/normalize";
import type {
  VerificationSession,
  VerificationResult,
  NrasVerificationResult,
  SignatureVerificationResult,
  NonceCheck,
  SignaturePayload,
  NearAIVerificationOptions,
} from "@/types/verification";

const DEFAULT_BASE_URL = "https://cloud-api.near.ai";
const DEFAULT_TIMEOUT = 120000; // 2 minutes

// ============================================================================
// Verification Constants
// ============================================================================
/** NVIDIA Remote Attestation Service endpoint */
const NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";
/** NVIDIA JWKS endpoint for JWT verification */
const NRAS_JWKS_URL = "https://nras.attestation.nvidia.com/.well-known/jwks.json";
/** Session TTL - 5 minutes */
const SESSION_TTL_MS = 5 * 60 * 1000;
/** JWKS cache TTL - 5 minutes */
const JWKS_TTL_MS = 5 * 60 * 1000;
/** Signature fetch timeout - 5 seconds */
const SIGNATURE_FETCH_TIMEOUT_MS = 5000;
const MAX_SIGNATURE_FETCH_ATTEMPTS = 2;

export class NearAIClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultTimeout: number;
  private readonly defaults: Required<
    Pick<ChatCompletionOptions, "retryAttempts" | "retryBaseDelayMs">
  > &
    Partial<Pick<ChatCompletionOptions, "verificationId" | "verificationNonce">>;
  private sessions = new Map<string, VerificationSession>();
  private jwksCache: { keys: jose.JWK[]; fetchedAt: number } | null = null;

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

  private buildVerificationHeaders(
    options?: NearAIVerificationOptions
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (!options) return headers;
    if (options.verificationId) {
      headers["X-Verification-Id"] = options.verificationId;
    }
    if (options.verificationNonce) {
      headers["X-Nonce"] = options.verificationNonce;
    }
    if (options.requestHash) {
      headers["X-Request-Hash"] = options.requestHash;
    }
    if (options.responseHash) {
      headers["X-Response-Hash"] = options.responseHash;
    }
    if (options.signingAlgo) {
      headers["X-Verification-Signing-Algo"] = options.signingAlgo;
    }
    if (options.extraHeaders) {
      Object.entries(options.extraHeaders).forEach(([key, value]) => {
        if (value) {
          headers[key] = value;
        }
      });
    }
    return headers;
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

      const verificationHeaders = this.buildVerificationHeaders({
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
      const verificationHeaders = this.buildVerificationHeaders({
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

  // ===========================================================================
  // Verification Session Management
  // ===========================================================================

  /**
   * Create or retrieve a verification session with a cryptographic nonce.
   *
   * The nonce is a 64-character hex string (32 bytes) that ensures attestation
   * freshness and prevents replay attacks.
   */
  createSession(verificationId: string, nonce?: string): VerificationSession {
    const now = Date.now();
    const existing = this.sessions.get(verificationId);

    const shouldReuse =
      existing && existing.expiresAt > now && !nonce;
    if (shouldReuse) {
      return existing;
    }

    const sessionNonce =
      nonce && this.isValidNonce(nonce) ? nonce : this.generateNonce();

    const session: VerificationSession = {
      nonce: sessionNonce,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.sessions.set(verificationId, session);
    return session;
  }

  /**
   * Get an existing session or null if not found/expired.
   */
  getSession(verificationId: string): VerificationSession | null {
    const session = this.sessions.get(verificationId);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(verificationId);
      return null;
    }
    return session;
  }

  /**
   * Update session with computed request/response hashes.
   *
   * Hashes are SHA-256 of the exact JSON request/response body strings.
   */
  updateSessionHashes(
    verificationId: string,
    hashes: { requestHash?: string | null; responseHash?: string | null }
  ): void {
    const session = this.getSession(verificationId);
    if (!session) {
      return;
    }
    this.sessions.set(verificationId, {
      ...session,
      requestHash: hashes.requestHash ?? session.requestHash,
      responseHash: hashes.responseHash ?? session.responseHash,
    });
  }

  /**
   * Clear a specific session.
   */
  clearSession(verificationId: string): void {
    this.sessions.delete(verificationId);
  }

  /**
   * Clear all sessions and caches (for testing).
   */
  clearAllSessions(): void {
    this.sessions.clear();
    this.jwksCache = null;
  }

  // ===========================================================================
  // Full Verification Flow
  // ===========================================================================

  /**
   * Verify a chat response from NEAR AI Cloud.
   *
   * This performs the complete verification flow:
   * 1. Fetch model attestation (proves TEE hardware authenticity)
   * 2. Fetch chat signature (proves response was signed by TEE)
   * 3. Verify attestation with NVIDIA NRAS
   * 4. Verify signature matches attested signing address
   * 5. Check nonce binding (prevents replay attacks)
   *
   * @param params.verificationId - Session ID created via createSession()
   * @param params.model - Model used (e.g., "deepseek-ai/DeepSeek-V3.1")
   * @param params.chatId - Chat completion ID from response (e.g., "chatcmpl-xxx")
   * @param params.requestHash - SHA-256 of request body (optional, uses session hash)
   * @param params.responseHash - SHA-256 of response body (optional, uses session hash)
   *
   * @see https://docs.near.ai/verification
   */
  async verify(params: {
    verificationId: string;
    model: string;
    chatId?: string;
    requestHash?: string;
    responseHash?: string;
  }): Promise<VerificationResult> {
    const session = this.getSession(params.verificationId);
    if (!session) {
      return { verified: false, reasons: ["Session not found or expired"] };
    }

    const requestHash = params.requestHash || session.requestHash;
    const responseHash = params.responseHash || session.responseHash;
    const reasons: string[] = [];

    const [attestation, signature] = await Promise.all([
      this.fetchAttestation(params.model, session.nonce),
      this.fetchSignature(params.chatId || params.verificationId, params.model),
    ]);

    if (!attestation) {
      reasons.push("Failed to fetch attestation");
    }

    if (!signature) {
      reasons.push("Failed to fetch signature");
    }

    let nras: NrasVerificationResult | null = null;
    if (attestation) {
      nras = await this.verifyWithNras(attestation, session.nonce);
      if (!nras.verified) {
        reasons.push(...(nras.reasons || ["NRAS verification failed"]));
      }
    }

    let signatureVerification: SignatureVerificationResult | undefined;
    if (signature && attestation) {
      const attestedAddresses = this.collectSigningAddresses(attestation);
      signatureVerification = this.verifySignature(
        signature,
        requestHash,
        responseHash,
        attestedAddresses
      );
      if (!signatureVerification.verified) {
        reasons.push(
          signatureVerification.reason || "Signature verification failed"
        );
      }
    } else {
      signatureVerification = {
        verified: false,
        reason: "Missing signature or attestation",
      };
    }

    const nonceCheck = this.checkNonceBinding(session.nonce, attestation);
    if (!nonceCheck.valid && attestation) {
      reasons.push("Nonce binding failed - possible replay attack");
    }

    return {
      verified: reasons.length === 0,
      reasons,
      attestation,
      signature,
      nras,
      signatureVerification,
      nonceCheck,
      requestHash,
      responseHash,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Generate a 64-character hex nonce (32 bytes) per NEAR AI spec.
   */
  private generateNonce(): string {
    const bytes = new Uint8Array(32);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      const { randomBytes } = require("crypto");
      const buf = randomBytes(32);
      bytes.set(buf);
    }
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private isValidNonce(value: string): boolean {
    return /^[0-9a-f]{64}$/i.test(value);
  }

  // ===========================================================================
  // NEAR AI Cloud - Verification Endpoints
  // ===========================================================================

  /**
   * Fetch model attestation report from NEAR AI Cloud.
   *
   * Returns attestation with:
   * - model_attestations[]: Array of GPU node attestations with signing_address, nvidia_payload, intel_quote
   * - gateway_attestation: Gateway TEE attestation with intel_quote
   *
   * @see https://docs.near.ai/verification
   */
  async fetchAttestation(
    model: string,
    nonce: string,
    signingAlgo: string = "ecdsa"
  ): Promise<unknown | null> {
    try {
      const params = new URLSearchParams({
        model,
        nonce,
        signing_algo: signingAlgo,
      });
      const url = `${this.baseUrl}/v1/attestation/report?${params}`;
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        console.warn(`[NearAIClient] Attestation fetch failed: ${response.status}`);
        return null;
      }
      return response.json();
    } catch (error) {
      console.error("[NearAIClient] Failed to fetch attestation:", error);
      return null;
    }
  }

  /**
   * Fetch gateway-only attestation (no model specified).
   */
  async fetchGatewayAttestation(
    nonce: string,
    signingAlgo: string = "ecdsa"
  ): Promise<unknown | null> {
    try {
      const params = new URLSearchParams({
        nonce,
        signing_algo: signingAlgo,
      });
      const url = `${this.baseUrl}/v1/attestation/report?${params}`;
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        console.warn(
          `[NearAIClient] Gateway attestation fetch failed: ${response.status}`
        );
        return null;
      }
      return response.json();
    } catch (error) {
      console.error("[NearAIClient] Failed to fetch gateway attestation:", error);
      return null;
    }
  }

  /**
   * Fetch chat message signature from NEAR AI Cloud.
   *
   * Returns:
   * - text: "{requestHash}:{responseHash}"
   * - signature: ECDSA signature of text
   * - signing_address: TEE public key that signed
   *   signing_algo: "ecdsa" or "ed25519"
   *
   * @param chatId - The chat completion ID (e.g., "chatcmpl-xxx")
   * @param model - The model used for the request
   */
  async fetchSignature(
    chatId: string,
    model: string,
    signingAlgo: string = "ecdsa"
  ): Promise<SignaturePayload | null> {
    try {
      const params = new URLSearchParams({
        model,
        signing_algo: signingAlgo,
      });
      const url = `${this.baseUrl}/v1/signature/${encodeURIComponent(chatId)}?${params}`;
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        console.warn(`[NearAIClient] Signature fetch failed: ${response.status}`);
        return null;
      }
      return response.json();
    } catch (error) {
      console.error("[NearAIClient] Failed to fetch signature:", error);
      return null;
    }
  }

  /**
   * Fetch canonical request/response hashes from a signed NEAR AI signature.
   */
  async fetchCanonicalHashes(options: {
    remoteMessageId?: string;
    fallbackId?: string;
    model: string;
    signingAlgo?: string;
  }): Promise<{ requestHash: string; responseHash: string } | null> {
    const { remoteMessageId, fallbackId, model, signingAlgo = "ecdsa" } = options;

    const candidates = Array.from(
      new Set(
        [remoteMessageId, fallbackId].filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
      )
    );

    if (candidates.length === 0) {
      return null;
    }

    for (const id of candidates) {
      const url = `${this.baseUrl}/v1/signature/${encodeURIComponent(
        id
      )}?model=${encodeURIComponent(model)}&signing_algo=${encodeURIComponent(
        signingAlgo
      )}`;

      let response: Response | null = null;

      for (let attempt = 0; attempt < MAX_SIGNATURE_FETCH_ATTEMPTS; attempt++) {
        try {
          response = await this.fetchWithTimeout(
            url,
            {
              headers: {
                "Content-Type": "application/json",
              },
            },
            SIGNATURE_FETCH_TIMEOUT_MS
          );
          break;
        } catch (error) {
          if (attempt === MAX_SIGNATURE_FETCH_ATTEMPTS - 1) {
            console.error(
              `[NearAIClient] Failed to fetch signature for hash extraction (${id}):`,
              error
            );
          } else {
            const backoff = 50 * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, backoff));
          }
        }
      }

      if (!response || !response.ok) {
        console.warn(
          `[NearAIClient] Failed to fetch signature for hash extraction (${id}): ${response?.status}`
        );
        continue;
      }

      try {
        const data = await response.json();
        const signaturePayload =
          normalizeSignaturePayload(data?.signature ?? data) ||
          normalizeSignaturePayload(data);
        const signedText =
          signaturePayload?.text ||
          (typeof data?.text === "string" ? data.text : null);
        const hashes = extractHashesFromSignedText(signedText);

        if (hashes) {
          return hashes;
        }

        console.warn(
          `[NearAIClient] Unable to parse hashes from signed text for (${id})`
        );
      } catch (error) {
        console.error(
          "[NearAIClient] Error parsing signature response for hash extraction:",
          error
        );
      }
    }

    return null;
  }

  /**
   * Fetch with timeout (internal helper for verification endpoints).
   */
  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs?: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = timeoutMs ?? this.defaultTimeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: HeadersInit = {
        Accept: "application/json",
        ...init?.headers,
      };

      if (this.apiKey) {
        (headers as Record<string, string>)["Authorization"] = `Bearer ${this.apiKey}`;
      }

      return await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ===========================================================================
  // NRAS (NVIDIA Remote Attestation Service) Verification
  // ===========================================================================

  /**
   * Verify GPU attestation with NVIDIA Remote Attestation Service.
   *
   * Submits nvidia_payload to NRAS and verifies:
   * - JWT signature using NVIDIA's public keys
   * - x-nvidia-overall-att-result is true
   * - eat_nonce matches our request nonce
   * - secboot (secure boot) is enabled
   * - measres (measurement results) is "success"
   *
   * @see https://docs.api.nvidia.com/attestation/reference/attestmultigpu_1
   */
  async verifyWithNras(
    attestation: unknown,
    expectedNonce: string
  ): Promise<NrasVerificationResult> {
    const nvidiaPayload = this.extractNvidiaPayload(attestation);
    if (!nvidiaPayload) {
      return { verified: false, reasons: ["No nvidia_payload in attestation"] };
    }

    try {
      const response = await fetch(NRAS_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nvidiaPayload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          verified: false,
          reasons: [`NRAS HTTP ${response.status}: ${errorText.slice(0, 100)}`],
        };
      }

      const data = await response.json();
      const jwt = this.extractNrasJwt(data);
      if (!jwt) {
        return { verified: false, reasons: ["No JWT in NRAS response"], raw: data };
      }

      const claims = await this.verifyNrasJwt(jwt);
      if (!claims) {
        return { verified: false, jwt, reasons: ["JWT signature verification failed"], raw: data };
      }

      const validationReasons = this.validateNrasClaims(claims, expectedNonce);
      return {
        verified: validationReasons.length === 0,
        jwt,
        claims,
        reasons: validationReasons.length > 0 ? validationReasons : undefined,
        raw: data,
      };
    } catch (error) {
      return {
        verified: false,
        reasons: [error instanceof Error ? error.message : "NRAS verification error"],
      };
    }
  }

  /**
   * Verify NRAS JWT signature using NVIDIA's public keys.
   */
  private async verifyNrasJwt(jwt: string): Promise<Record<string, unknown> | null> {
    try {
      const jwks = await this.getJwks();
      const JWKS = jose.createLocalJWKSet({ keys: jwks });
      const { payload } = await jose.jwtVerify(jwt, JWKS, {
        algorithms: ["ES384"],
      });
      return payload as Record<string, unknown>;
    } catch (error) {
      console.error("[NearAIClient] JWT verification failed:", error);
      return null;
    }
  }

  /**
   * Fetch and cache NVIDIA's JWKS (JSON Web Key Set).
   */
  private async getJwks(): Promise<jose.JWK[]> {
    if (this.jwksCache && Date.now() - this.jwksCache.fetchedAt < JWKS_TTL_MS) {
      return this.jwksCache.keys;
    }

    const response = await fetch(NRAS_JWKS_URL);
    if (!response.ok) {
      throw new NearAIError("Failed to fetch NRAS JWKS", response.status);
    }

    const data = await response.json();
    this.jwksCache = { keys: data.keys ?? [], fetchedAt: Date.now() };
    return data.keys ?? [];
  }

  /**
   * Validate NRAS JWT claims per NEAR AI verification requirements.
   */
  private validateNrasClaims(
    claims: Record<string, unknown>,
    expectedNonce: string
  ): string[] {
    const reasons: string[] = [];

    if (claims["x-nvidia-overall-att-result"] !== true) {
      reasons.push("x-nvidia-overall-att-result is not true");
    }

    const claimNonce = String(
      claims.eat_nonce || claims["eat_nonce"] || ""
    ).toLowerCase();
    if (claimNonce !== expectedNonce.toLowerCase()) {
      reasons.push(
        `Nonce mismatch: expected ${expectedNonce.slice(0, 16)}..., got ${
          claimNonce.slice(0, 16) || "(empty)"
        }...`
      );
    }

    if (claims.secboot !== true) {
      reasons.push("Secure boot (secboot) is not enabled");
    }

    const measres = String(claims.measres || "").toLowerCase();
    if (measres && measres !== "success") {
      reasons.push(`Measurement results (measres): ${measres}`);
    }

    return reasons;
  }

  /**
   * Extract nvidia_payload from attestation response.
   */
  private extractNvidiaPayload(attestation: unknown): unknown | null {
    const a = attestation as Record<string, unknown> | null;
    if (!a) return null;

    const modelAttestations = a.model_attestations as unknown[];
    if (Array.isArray(modelAttestations) && modelAttestations.length > 0) {
      const first = modelAttestations[0] as Record<string, unknown>;
      if (first?.nvidia_payload) return first.nvidia_payload;
    }

    const gateway = a.gateway_attestation as Record<string, unknown>;
    if (gateway?.nvidia_payload) return gateway.nvidia_payload;

    if (a.nvidia_payload) return a.nvidia_payload;

    return null;
  }

  /**
   * Extract JWT from NRAS response.
   */
  private extractNrasJwt(data: unknown): string | null {
    if (Array.isArray(data)) {
      for (const item of data) {
        if (Array.isArray(item) && item[0] === "JWT" && typeof item[1] === "string") {
          return item[1];
        }
      }
    }
    const jwtValue = (data as Record<string, unknown>)?.jwt;
    return typeof jwtValue === "string" ? jwtValue : null;
  }

  // ===========================================================================
  // Signature Verification
  // ===========================================================================

  /**
   * Verify chat message signature.
   *
   * Per NEAR AI docs:
   * - text is "{requestHash}:{responseHash}"
   * - Recover address using ethers.verifyMessage
   * - Compare with signing_address from attestation
   */
  private verifySignature(
    signature: SignaturePayload | null,
    requestHash: string | null | undefined,
    responseHash: string | null | undefined,
    attestedAddresses: string[]
  ): SignatureVerificationResult {
    if (!signature?.signature || !signature?.text) {
      return { verified: false, reason: "Missing signature or signed text" };
    }

    if (requestHash && responseHash) {
      const expectedText = `${requestHash}:${responseHash}`.toLowerCase();
      const actualText = signature.text.trim().toLowerCase();

      if (expectedText !== actualText) {
        return {
          verified: false,
          reason: `Hash mismatch: expected ${expectedText.slice(0, 32)}..., got ${actualText.slice(
            0,
            32
          )}...`,
        };
      }
    }

    let recoveredAddress: string;
    try {
      recoveredAddress = verifyMessage(signature.text, signature.signature);
    } catch {
      return {
        verified: false,
        reason: "Failed to recover address from signature",
      };
    }

    const normalizedAddress = recoveredAddress.toLowerCase();
    const matched = attestedAddresses.some((addr) => addr.toLowerCase() === normalizedAddress);

    if (!matched && attestedAddresses.length > 0) {
      return {
        verified: false,
        recoveredAddress,
        attestedAddresses,
        reason: `Recovered address ${recoveredAddress} not in attested addresses`,
      };
    }

    return {
      verified: true,
      recoveredAddress,
      attestedAddresses,
    };
  }

  /**
   * Collect signing addresses from attestation response.
   *
   * Addresses come from:
   * - model_attestations[].signing_address
   * - gateway_attestation.signing_address
   */
  private collectSigningAddresses(attestation: unknown): string[] {
    const addresses: string[] = [];
    const a = attestation as Record<string, unknown> | null;
    if (!a) return addresses;

    const addIfValid = (addr: unknown) => {
      if (typeof addr === "string" && addr.startsWith("0x")) {
        addresses.push(addr);
      }
    };

    const modelAttestations = a.model_attestations as unknown[];
    if (Array.isArray(modelAttestations)) {
      for (const m of modelAttestations) {
        addIfValid((m as Record<string, unknown>)?.signing_address);
      }
    }

    const gateway = a.gateway_attestation as Record<string, unknown>;
    if (gateway) {
      addIfValid(gateway.signing_address);
    }

    addIfValid(a.signing_address);

    return [...new Set(addresses)];
  }

  /**
   * Check nonce binding in attestation.
   *
   * Per NEAR AI docs, the request_nonce in gateway_attestation should match
   * the nonce we provided in the attestation request.
   */
  private checkNonceBinding(expectedNonce: string, attestation: unknown): NonceCheck {
    const a = attestation as Record<string, unknown> | null;
    if (!a) {
      return { valid: false, expected: expectedNonce, attested: null };
    }

    const gateway = a.gateway_attestation as Record<string, unknown>;
    const attestedNonce =
      gateway?.request_nonce ||
      a.request_nonce ||
      a.nonce;

    const attested = typeof attestedNonce === "string" ? attestedNonce : null;
    const valid = !!attested && attested.toLowerCase() === expectedNonce.toLowerCase();

    return { valid, expected: expectedNonce, attested };
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
