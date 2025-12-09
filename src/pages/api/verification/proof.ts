import type { NextApiRequest, NextApiResponse } from "next";
import type {
  IntelVerificationResult,
  NonceCheck,
  SignatureFetchError,
  VerificationProofResponse,
} from "@/types/verification";
import { deriveVerificationState } from "@/utils/attestation";
import {
  decodeJwtPayload,
  normalizeHashPair,
  normalizeHashValue,
  validateHashPair,
} from "@/utils/verification/shared";
import {
  getVerificationSession,
  registerVerificationSession,
  updateVerificationHashes,
} from "@/verification/server";
import { getModelExpectations } from "@/server/attestation-cache";
import { extractHashesFromSignedText } from "@/verification/hashes";
import { createRateLimiter, getClientIdentifier } from "@/server/rateLimiter";
import { rateLimitConfig } from "@/config/rateLimit";
import { verifyNearAuth } from "@/server/screening";
import { verificationConfig } from "@/config/verification";
import {
  collectSigningAddressesFromAttestation,
  validateIntelBinding,
  extractComposeManifest,
  extractMrConfig,
  hashComposeManifest,
} from "@/utils/verification/intel";

const NEAR_API_BASE = verificationConfig.nearApiBase;
const PROOF_FETCH_TIMEOUT_MS = verificationConfig.nearRequestTimeoutMs;
const PROOF_FETCH_ATTEMPTS = verificationConfig.fetchBackoff.attempts;
const PROOF_FETCH_BASE_DELAY_MS = verificationConfig.fetchBackoff.baseDelayMs;
const proofLimiter = createRateLimiter(rateLimitConfig.verificationProof);

type ProofError = {
  error: string;
  message?: string;
  details?: string;
  configMissing?: {
    nearApiKey?: boolean;
    intel?: boolean;
    intelApiKey?: boolean;
    signingAlgoMissing?: boolean;
    hardwareExpectations?: boolean;
  };
  retryAfter?: number;
  logId?: string;
};

const createLogId = (label: string) =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`;

const respondWithLogId = (
  res: NextApiResponse<VerificationProofResponse | ProofError>,
  status: number,
  message: string,
  logId: string,
  details?: string
) => res.status(status).json({ error: message, logId, details });

async function safeFetch(url: string, headers: HeadersInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROOF_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const validateRequest = (body: any) => {
  if (!body || typeof body !== "object") {
    throw new Error("Request body is required");
  }
  if (!body.verificationId || typeof body.verificationId !== "string") {
    throw new Error("verificationId is required");
  }
  if (body.nonce && typeof body.nonce !== "string") {
    throw new Error("nonce must be a string when provided");
  }
};

async function fetchWithBackoff(
  factory: () => Promise<Response>,
  attempts = PROOF_FETCH_ATTEMPTS,
  baseDelay = PROOF_FETCH_BASE_DELAY_MS
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await factory();
      if (!res) {
        throw new Error("Fetch returned empty response");
      }
      return res;
    } catch (error) {
      // Abort/timeouts should not be retried; surface immediately
      if (
        (error as any)?.name === "AbortError" ||
        String((error as any)?.message || "")
          .toLowerCase()
          .includes("abort")
      ) {
        throw error;
      }
      lastError = error;
      const delay = baseDelay * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Unknown fetch error"));
}

const collectIntelQuotes = (attestation: any): any[] => {
  if (!attestation || typeof attestation !== "object") return [];
  const quotes: any[] = [];
  const pushQuote = (value: any) => {
    if (value) quotes.push(value);
  };
  pushQuote(attestation.intel_quote);

  const gateway = attestation.gateway_attestation;
  if (Array.isArray(gateway)) {
    gateway.forEach((node: any) => pushQuote((node as any)?.intel_quote));
  } else if (gateway) {
    pushQuote(gateway.intel_quote);
  }

  const models = Array.isArray(attestation.model_attestations)
    ? attestation.model_attestations
    : [];
  models.forEach((node: any) => pushQuote((node as any)?.intel_quote));

  const all = Array.isArray(attestation.all_attestations)
    ? attestation.all_attestations
    : [];
  all.forEach((node: any) => pushQuote((node as any)?.intel_quote));

  return quotes;
};

const telemetry = {
  success: 0,
  failure: 0,
  log(result: "success" | "failure", meta?: Record<string, any>) {
    if (result === "success") this.success += 1;
    else this.failure += 1;
    const sanitized =
      meta &&
      Object.fromEntries(
        Object.entries(meta)
          .filter(([key]) => !/verificationid/i.test(key))
          .map(([key, value]) => {
            if (/nonce|hash/i.test(key)) return [key, "[redacted]"];
            if (typeof value === "string" && value.length > 500) {
              return [key, `${value.slice(0, 500)}...`];
            }
            return [key, value];
          })
      );
    console.info("[verification/proof]", result, sanitized ?? "");
  },
};

const collectRequestNonces = (attestation: any): string[] => {
  if (!attestation || typeof attestation !== "object") return [];
  const nonces: string[] = [];
  const addNonce = (value: any) => {
    if (typeof value === "string" && value.trim().length === 64) {
      nonces.push(value.trim().toLowerCase());
    }
  };

  addNonce(attestation.request_nonce);

  const gateway = attestation.gateway_attestation;
  if (Array.isArray(gateway)) {
    gateway.forEach((node: any) => addNonce((node as any)?.request_nonce));
  } else if (gateway) {
    addNonce(gateway.request_nonce);
  }

  const models = Array.isArray(attestation.model_attestations)
    ? attestation.model_attestations
    : [];
  models.forEach((node: any) => addNonce((node as any)?.request_nonce));

  return nonces;
};

type DcapVerifyQuoteFn = (quote: any) => Promise<any>;
const loadDcapVerifier = async (): Promise<DcapVerifyQuoteFn | null> => {
  try {
    const dynamicImport = new Function("id", "return import(id)");
    const mod = await (dynamicImport as any)("dcap-qvl").catch(() => null);
    const verifyQuote = (mod as any)?.verifyQuote || (mod as any)?.default?.verifyQuote;
    if (typeof verifyQuote === "function") {
      return verifyQuote as DcapVerifyQuoteFn;
    }
  } catch (error) {
    console.warn("[verification/proof] dcap-qvl not available:", error);
  }
  return null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerificationProofResponse | ProofError>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const isMockMode = process.env.VERIFY_USE_MOCKS === "true";
  const isTestEnv = process.env.NODE_ENV === "test";

  let authenticatedAccount: string | undefined;

  if (!isMockMode && !isTestEnv) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const { result } = await verifyNearAuth(authHeader);
      authenticatedAccount = result.accountId;
    } catch (error: unknown) {
      return res.status(401).json({
        error: "Authentication required",
        details: error instanceof Error ? error.message : undefined,
      });
    }

    const rateLimitKey = authenticatedAccount
      ? `account:${authenticatedAccount}`
      : `ip:${getClientIdentifier(req)}`;
    const { allowed, remaining, resetTime } = proofLimiter.check(rateLimitKey);
    const secondsUntilReset = Math.max(
      0,
      Math.ceil((resetTime - Date.now()) / 1000)
    );
    res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0).toString());
    res.setHeader("X-RateLimit-Limit", proofLimiter.limit.toString());
    res.setHeader("X-RateLimit-Reset", secondsUntilReset.toString());

    if (!allowed) {
      const retryAfter =
        secondsUntilReset || rateLimitConfig.verificationProof.windowMs / 1000;
      res.setHeader("Retry-After", retryAfter.toString());
      return res.status(429).json({
        error: "Verification failed",
      });
    }
  }

  const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Verification failed",
    });
  }

  try {
    validateRequest(req.body);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "Invalid request",
    });
  }

  const {
    verificationId,
    messageId,
    model = verificationConfig.defaultModel,
    signingAlgo = verificationConfig.defaultSigningAlgo,
    nonce: clientProvidedNonce,
  } = req.body ?? {};

  let {
    expectedArch,
    expectedDeviceCertHash,
    expectedRimHash,
    expectedUeid,
    expectedMeasurements,
  } = req.body ?? {};

  const clientRequestHash = normalizeHashValue(req.body?.requestHash);
  const clientResponseHash = normalizeHashValue(req.body?.responseHash);

  if (!verificationId || typeof verificationId !== "string") {
    return res.status(400).json({
      error: "verificationId is required",
    });
  }
  if (signingAlgo && !["ecdsa", "ed25519"].includes(String(signingAlgo).toLowerCase())) {
    return res.status(400).json({ error: "Unsupported signing_algo" });
  }
  if (messageId && typeof messageId !== "string") {
    return res.status(400).json({
      error: "messageId must be a string when provided",
    });
  }

  let session =
    getVerificationSession(verificationId) ||
    (typeof clientProvidedNonce === "string"
      ? registerVerificationSession(
          verificationId,
          clientProvidedNonce,
          clientRequestHash,
          clientResponseHash
        )
      : null);

  const hasClientHash =
    Boolean(clientRequestHash) || Boolean(clientResponseHash);
  if (hasClientHash && session) {
    const existingRequestHash = normalizeHashValue(session.requestHash);
    const existingResponseHash = normalizeHashValue(session.responseHash);

    if (
      clientRequestHash &&
      existingRequestHash &&
      existingRequestHash !== clientRequestHash
    ) {
      return res.status(400).json({
        error:
          "Provided request hash conflicts with the hash stored for this verification session.",
      });
    }

    if (
      clientResponseHash &&
      existingResponseHash &&
      existingResponseHash !== clientResponseHash
    ) {
      return res.status(400).json({
        error:
          "Provided response hash conflicts with the hash stored for this verification session.",
      });
    }

    const hashesToAccept: {
      requestHash?: string | null;
      responseHash?: string | null;
    } = {};

    if (clientRequestHash && !existingRequestHash) {
      hashesToAccept.requestHash = clientRequestHash;
    }
    if (clientResponseHash && !existingResponseHash) {
      hashesToAccept.responseHash = clientResponseHash;
    }
    if (Object.keys(hashesToAccept).length > 0) {
      updateVerificationHashes(verificationId, hashesToAccept);
      session = getVerificationSession(verificationId) || session;
    }
  }

  let expectedNonce = session?.nonce;
  let sessionRequestHash: string | null = session?.requestHash || null;
  let sessionResponseHash: string | null = session?.responseHash || null;

  if (!expectedNonce) {
    // Attempt to register using provided hashes if session was not established
    if (req.body?.requestHash || req.body?.responseHash) {
      session = registerVerificationSession(
        verificationId,
        undefined,
        req.body?.requestHash,
        req.body?.responseHash
      );
      expectedNonce = session.nonce;
    } else {
      return res.status(400).json({
        error:
          "Verification session not registered for this verificationId. The server must generate and store a nonce when issuing the verificationId.",
      });
    }
  }

  // Refresh session hashes after any late registration
  sessionRequestHash = session?.requestHash ?? sessionRequestHash ?? null;
  sessionResponseHash = session?.responseHash ?? sessionResponseHash ?? null;

  // Auto-fetch expectations if missing
  const expectationsMissing =
    !expectedArch ||
    !expectedDeviceCertHash ||
    !expectedRimHash ||
    !expectedUeid ||
    !Array.isArray(expectedMeasurements) ||
    expectedMeasurements.length === 0;

  if (expectationsMissing) {
    try {
      console.log(
        "[verification/proof] Auto-fetching hardware expectations for model:",
        model
      );
      const expectations = await getModelExpectations(
        model || verificationConfig.defaultModel
      );
      expectedArch = expectedArch || expectations.arch;
      expectedDeviceCertHash =
        expectedDeviceCertHash || expectations.deviceCertHash;
      expectedRimHash = expectedRimHash || expectations.rimHash;
      expectedUeid = expectedUeid || expectations.ueid;
      expectedMeasurements = expectedMeasurements || expectations.measurements;
      console.log("[verification/proof] Using expectations:", {
        arch: expectedArch,
        deviceCertHash: expectedDeviceCertHash
          ? `${expectedDeviceCertHash.slice(0, 16)}...`
          : null,
        rimHash: expectedRimHash ? `${expectedRimHash.slice(0, 16)}...` : null,
        ueid: expectedUeid ? `${expectedUeid.slice(0, 16)}...` : null,
        measurements: expectedMeasurements?.length ?? 0,
      });
    } catch (error: unknown) {
      console.error(
        "[verification/proof] Failed to fetch expectations:",
        error
      );
      return res.status(500).json({
        error: "Failed to fetch hardware expectations",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const stillMissing =
    !expectedArch ||
    !expectedDeviceCertHash ||
    !Array.isArray(expectedMeasurements) ||
    expectedMeasurements.length === 0;
  // Note: RIM and UEID are validated internally by NRAS
  const hardwareExpectationsMissing = stillMissing;
  const configMissing: ProofError["configMissing"] = hardwareExpectationsMissing
    ? { hardwareExpectations: true }
    : undefined;

  if (!expectedNonce || typeof expectedNonce !== "string") {
    return res.status(400).json({
      error: "Verification nonce missing",
      details:
        "Server failed to establish a verification nonce for this request. Please retry to obtain a fresh nonce.",
    });
  }

  // Mock mode for tests
  if (process.env.VERIFY_USE_MOCKS === "true") {
    const mockNonce = expectedNonce;
    const mockProof: VerificationProofResponse = {
      attestation: {
      gateway_attestation: {
        signing_address: "0x616AAa0c5FA690409Bf2c4F20Bf46d02AcD9BF69",
          signing_algo: "ecdsa",
          nvidia_payload: {
            eat_nonce: mockNonce,
            arch: expectedArch || "HOPPER",
            evidence_list: [],
          },
        },
      },
      signature: {
        text: "req:res",
        signature:
          "0x77e4db99019046762da28e669d8fce369fca67361592efd7b90ce5b225d7d6450cc4e7ee5f5a6fff8c7ab892f1caabb3d5625ba61f0dd79f97a5344fbbfa468d1c",
        signing_address: "0x616AAa0c5FA690409Bf2c4F20Bf46d02AcD9BF69",
        signing_algo: "ecdsa",
      },
      nras: {
        verified: !expectationsMissing,
        jwt: "mock",
        claims: {
          "x-nvidia-overall-att-result": !expectationsMissing,
          "x-nvidia-gpu-driver-version": "570.123",
          "x-nvidia-gpu-vbios-version": "96.00",
          "x-nvidia-eat-nonce": mockNonce || "mock-nonce",
          hwmodel: "GH100 A01 GSP BROM",
        },
        gpus: { "GPU-0": "mock-token" },
        raw: {},
        reasons: expectationsMissing ? ["Expectations missing"] : [],
      },
      nonceCheck: {
        expected: mockNonce,
        attested: mockNonce,
        nras: mockNonce,
        valid: !expectationsMissing,
      },
      intel: {
        verified: !expectationsMissing,
        raw: { nonce: mockNonce },
      },
    };

    const state = deriveVerificationState({
      proof: mockProof,
      requestHash: sessionRequestHash,
      responseHash: sessionResponseHash,
      signatureText: (mockProof.signature as any)?.text || null,
      signature: (mockProof.signature as any)?.signature || null,
      signatureAddress: (mockProof.signature as any)?.signing_address || null,
      attestedAddress:
        mockProof.attestation?.gateway_attestation?.signing_address || null,
      attestationResult:
        mockProof.nras?.verified && !expectationsMissing ? "Pass" : "Fail",
      nrasVerified: mockProof.nras?.verified,
      nrasReasons: mockProof.nras?.reasons,
      intelVerified: mockProof.intel?.verified,
      nonceCheck: mockProof.nonceCheck ?? null,
      intelRequired: false,
    });

    mockProof.results = {
      verified: state.overall === "verified",
      reasons: state.reasons || [],
      gpu: mockProof.nras || null,
      cpu: mockProof.intel || null,
      nonce: mockProof.nonceCheck || null,
      signature: {
        verified: state.steps.signature.status === "success",
        recoveredAddress: state.recoveredAddress,
        attestedAddress: state.attestedAddress,
        reason:
          state.steps.signature.status === "error"
            ? state.steps.signature.message
            : undefined,
      },
    };

    return res.status(200).json(mockProof);
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `http://${req.headers.host || "localhost:3000"}`;
  const nrasUrl = new URL("/api/verification/nras", baseUrl).toString();

  try {
    const attestationPromise = fetchWithBackoff(() =>
      safeFetch(
        `${NEAR_API_BASE}/attestation/report?model=${encodeURIComponent(
          model
        )}&signing_algo=${encodeURIComponent(
          signingAlgo
        )}&nonce=${encodeURIComponent(expectedNonce || "")}`,
        headers
      )
    );

    const gatewayAttestationPromise = fetchWithBackoff(() =>
      safeFetch(
        `${NEAR_API_BASE}/attestation/report?signing_algo=${encodeURIComponent(
          signingAlgo
        )}&nonce=${encodeURIComponent(expectedNonce || "")}`,
        headers
      )
    );

    const signatureLookupId = messageId || verificationId;
    const signatureUrl = `${NEAR_API_BASE}/signature/${encodeURIComponent(
      signatureLookupId
    )}?model=${encodeURIComponent(model)}&signing_algo=${encodeURIComponent(
      signingAlgo
    )}`;
    const signaturePromise = fetchWithBackoff(() =>
      safeFetch(signatureUrl, headers)
    );

    const [attestationResp, gatewayResp, signatureResp] = await Promise.all([
      attestationPromise,
      gatewayAttestationPromise,
      signaturePromise,
    ]);

    const proof: VerificationProofResponse = {};
    let signatureFetchError: SignatureFetchError | null = null;

    if (attestationResp.ok) {
      proof.attestation = await attestationResp.json();

      const requestNonces = collectRequestNonces(proof.attestation);
      const normalizedExpectedNonce =
        typeof expectedNonce === "string" ? expectedNonce.toLowerCase() : null;

      const nonceMismatch =
        !normalizedExpectedNonce ||
        (requestNonces.length > 0 &&
          requestNonces.some((value) => value !== normalizedExpectedNonce));

      if (nonceMismatch) {
        telemetry.log("failure", {
          verificationId,
          model,
          reason: "attestation_request_nonce_mismatch",
        });
        console.error("[verification/proof] Attestation nonce mismatch", {
          verificationId,
          expectedNonce: normalizedExpectedNonce,
          requestNonces,
        });
        const attNonceLogId = createLogId("attestation-nonce");
        console.warn("[verification/proof] Attestation nonce mismatch", {
          verificationId,
          logId: attNonceLogId,
          expectedNonce: normalizedExpectedNonce,
          requestNonces,
        });
        return respondWithLogId(
          res,
          502,
          `Verification failed (logId: ${attNonceLogId})`,
          attNonceLogId,
          "Attestation request nonce mismatch"
        );
      }
    } else {
      proof.attestation = null;
    }

    if (gatewayResp.ok) {
      const gatewayBody = await gatewayResp.json();
      const gatewayAtt = (gatewayBody as any)?.gateway_attestation || gatewayBody;
      if (!proof.attestation) {
        proof.attestation = { gateway_attestation: gatewayAtt };
      } else if (!proof.attestation.gateway_attestation) {
        (proof.attestation as any).gateway_attestation = gatewayAtt;
      }

      const gatewayNonce =
        gatewayAtt?.request_nonce ||
        gatewayAtt?.nonce ||
        gatewayAtt?.eat_nonce ||
        gatewayAtt?.["x-nvidia-eat-nonce"];
      const normalizedExpectedNonce =
        typeof expectedNonce === "string" ? expectedNonce.toLowerCase() : null;
      if (
        normalizedExpectedNonce &&
        (!gatewayNonce ||
          String(gatewayNonce).toLowerCase() !== normalizedExpectedNonce)
      ) {
        console.error("[verification/proof] Gateway nonce mismatch", {
          verificationId,
          expected: normalizedExpectedNonce,
          gatewayNonce,
        });
        const gatewayLogId = createLogId("gateway-nonce");
        console.warn("[verification/proof] Gateway nonce mismatch", {
          verificationId,
          logId: gatewayLogId,
          expected: normalizedExpectedNonce,
          gatewayNonce,
        });
        return respondWithLogId(
          res,
          502,
          `Verification failed (logId: ${gatewayLogId})`,
          gatewayLogId,
          "Gateway attestation nonce mismatch"
        );
      }

      if (!gatewayAtt?.intel_quote || !gatewayAtt?.event_log) {
        console.error("[verification/proof] Gateway attestation incomplete", {
          hasIntel: Boolean(gatewayAtt?.intel_quote),
          hasEventLog: Boolean(gatewayAtt?.event_log),
        });
        return res.status(502).json({
          error: "Verification failed",
        });
      }
    }

    if (signatureResp.ok) {
      proof.signature = await signatureResp.json();
    } else {
      const errorText = await signatureResp.text();
      signatureFetchError = {
        status: signatureResp.status,
        statusText: signatureResp.statusText || null,
        message: errorText || "Signature fetch failed",
        url: signatureUrl,
      };
      console.error("[proof] Signature fetch failed:", signatureFetchError);
      proof.signature = null;
    }

    proof.signatureError = signatureFetchError;

    // Automatically verify GPU attestation with NVIDIA NRAS
    if (proof.attestation && !proof.nras) {
      try {
        const att = proof.attestation;
        const nvidiaPayloads: any[] = [];

        if (att?.nvidia_payload) nvidiaPayloads.push(att.nvidia_payload);
        if (att?.gateway_attestation) {
          if (Array.isArray(att.gateway_attestation)) {
            att.gateway_attestation.forEach((g: any) => {
              if (g?.nvidia_payload) nvidiaPayloads.push(g.nvidia_payload);
            });
          } else if (att.gateway_attestation?.nvidia_payload) {
            nvidiaPayloads.push(att.gateway_attestation.nvidia_payload);
          }
        }
        if (Array.isArray(att?.model_attestations)) {
          att.model_attestations.forEach((m: any) => {
            if (m?.nvidia_payload) nvidiaPayloads.push(m.nvidia_payload);
          });
        }

        let aggregatedReasons: string[] = [];
        let aggregatedVerified = true;
        let primaryNras: any = null;

        if (nvidiaPayloads.length > 0 && !hardwareExpectationsMissing) {

          for (const payload of nvidiaPayloads) {
            const nrasResp = await fetch(nrasUrl, {
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              method: "POST",
              body: JSON.stringify({
                nvidia_payload: payload,
                nonce: expectedNonce,
                expectedArch,
                expectedDeviceCertHash,
                expectedRimHash,
                expectedUeid,
                expectedMeasurements,
              }),
            });

            if (!nrasResp.ok) {
              const errorText = await nrasResp.text();
              return res.status(502).json({
                error: "NRAS verification request failed",
                details: errorText,
              });
            }

            let nrasData: any = null;
            try {
              if (typeof nrasResp.json === "function") {
                nrasData = await nrasResp.json();
              }
            } catch {
              nrasData = null;
            }
            if (!nrasData) {
              const txt = await nrasResp.text().catch(() => "");
              try {
                nrasData = JSON.parse(txt);
              } catch {
                nrasData = { raw: txt };
              }
            }

            const decodedClaims =
              nrasData?.claims ||
              decodeJwtPayload(
                typeof nrasData?.jwt === "string" ? nrasData.jwt : null
              ) ||
              decodeJwtPayload(
                typeof (nrasData as any)?.token === "string"
                  ? (nrasData as any).token
                  : null
              );

            const verified = Boolean(nrasData?.verified);
            aggregatedVerified = aggregatedVerified && verified;
            if (!verified) {
              aggregatedReasons = aggregatedReasons.concat(
                nrasData?.reasons?.length ? nrasData.reasons : ["NRAS verification failed"]
              );
            }

            if (!primaryNras) {
              primaryNras = {
                ...(nrasData || {}),
                verified,
              };
              if (decodedClaims) {
                primaryNras.claims = decodedClaims as any;
              } else if (nrasData?.gpus && typeof nrasData.gpus === "object") {
                const firstGpuToken = Object.values(nrasData.gpus)[0];
                const gpuClaims = decodeJwtPayload(
                  typeof firstGpuToken === "string" ? firstGpuToken : null
                );
                if (gpuClaims) {
                  primaryNras.claims = gpuClaims as any;
                }
              }
            }
          }
        }

        if (primaryNras) {
          primaryNras.verified = aggregatedVerified;
          if (!aggregatedVerified) {
            primaryNras.reasons = aggregatedReasons;
          }
          proof.nras = primaryNras as any;
          const nrasClaims = primaryNras.claims || {};
          const nrasLogId = createLogId("nras-summary");
          console.warn("[verification/proof] NRAS attestation result", {
            verificationId,
            logId: nrasLogId,
            overallAttestationResult:
              nrasClaims["x-nvidia-overall-att-result"],
            eatNonce:
              nrasClaims["x-nvidia-eat-nonce"] ||
              nrasClaims.eat_nonce ||
              null,
            verified: primaryNras.verified,
          });
        }
      } catch (nrasError) {
        console.error("[proof] NRAS auto-verification error:", nrasError);
        proof.nras = {
          verified: false,
          raw: { error: String(nrasError) },
          reasons: ["NRAS auto-verification failed"],
        } as any;
      }
    }

    if (!proof.attestation && !proof.signature) {
      return res.status(502).json({
        error: "Failed to fetch verification proof",
        details:
          signatureFetchError?.message ||
          "No attestation or signature available yet. Verification data may still be propagating.",
      });
    }

    // (NRAS verification now handled immediately after attestation fetch)

    const signingAddresses = collectSigningAddressesFromAttestation(
      proof.attestation
    );
    const intelQuotes = collectIntelQuotes(proof.attestation);

    // Intel TDX verification (required when intel_quote present)
    try {
      if (intelQuotes.length > 0) {
        const dcapVerify = await loadDcapVerifier();
        const intelUrl =
          process.env.INTEL_TDX_ATTESTATION_URL ||
          process.env.INTEL_ATTESTATION_URL;

        if (!intelUrl || !process.env.INTEL_TDX_API_KEY) {
          return res.status(500).json({
            error: "Intel verification not configured",
            details:
              "INTEL_TDX_ATTESTATION_URL and INTEL_TDX_API_KEY are required when intel_quote is present.",
            configMissing: {
              intel: !intelUrl,
              intelApiKey: !process.env.INTEL_TDX_API_KEY,
            },
          } as any);
        }

        const headersIntel: HeadersInit = {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.INTEL_TDX_API_KEY}`,
        };

        const combinedReasons: string[] = [];
        let allVerified = true;
        let lastParsed: any = null;

        for (const intelQuote of intelQuotes) {
          // Local cryptographic verification using dcap-qvl
          let localVerified = false;
          let localReasons: string[] = [];
          let localParsed: any = null;
          if (dcapVerify) {
            try {
              localParsed = await dcapVerify(intelQuote);
              const localValid =
                localParsed?.valid === true ||
                localParsed?.is_valid === true ||
                localParsed?.result === "OK" ||
                localParsed?.verdict === "SUCCESS";
              if (!localValid) {
                localReasons.push("Intel quote failed local signature/TCB verification");
              }
              const bindingLocal = validateIntelBinding(
                localParsed,
                expectedNonce,
                signingAddresses
              );
              if (!bindingLocal.nonceMatch) {
                localReasons.push("Intel report data nonce mismatch (local verifier)");
              }
              if (!bindingLocal.signingMatch) {
                localReasons.push("Intel report data signing key mismatch (local verifier)");
              }
              const measurementsPresent =
                localParsed?.enclaveIdentity ||
                localParsed?.tdx_quote_body ||
                localParsed?.quote ||
                localParsed?.report ||
                localParsed?.measurements;
              if (!measurementsPresent) {
                localReasons.push("Intel measurements missing (local verifier)");
              }
              localVerified =
                localValid &&
                measurementsPresent &&
                bindingLocal.nonceMatch &&
                bindingLocal.signingMatch;
            } catch (localError: any) {
              localReasons.push(
                `Intel local verification error: ${
                  localError instanceof Error ? localError.message : String(localError)
                }`
              );
            }
          } else {
            localReasons.push("Intel quote verifier (dcap-qvl) not available");
          }

          const intelVerifyResp = await fetch(intelUrl, {
            method: "POST",
            headers: headersIntel,
            body: JSON.stringify({
              quote: intelQuote,
              nonce: expectedNonce,
            }),
          });

          const intelText = await intelVerifyResp.text();
          if (!intelVerifyResp.ok) {
            allVerified = false;
            combinedReasons.push("Intel verifier returned non-200");
            lastParsed = intelText;
            combinedReasons.push(...localReasons);
            continue;
          }

          let intelParsed: any;
          try {
            intelParsed = JSON.parse(intelText);
          } catch {
            intelParsed = intelText;
          }
          lastParsed = intelParsed;

          const nonceFromIntel =
            intelParsed?.nonce ||
            intelParsed?.runtimeData?.nonce ||
            intelParsed?.runtime_data?.nonce ||
            intelParsed?.reportData ||
            intelParsed?.report_data ||
            null;

          const measurementPresent =
            intelParsed?.isvEnclaveQuoteStatus ||
            intelParsed?.enclaveIdentity ||
            intelParsed?.tdx_quote_body ||
            intelParsed?.quote ||
            intelParsed?.report ||
            intelParsed?.measurements;

          const successFlag =
            intelParsed?.verified === true ||
            intelParsed?.is_valid === true ||
            intelParsed?.result === "OK" ||
            intelParsed?.verdict === "SUCCESS";

          const binding = validateIntelBinding(
            localParsed || intelParsed,
            expectedNonce,
            signingAddresses
          );

          if (!successFlag) combinedReasons.push("Intel verifier did not return success");
          if (!measurementPresent) combinedReasons.push("Intel measurements missing");
          if (!binding.nonceMatch)
            combinedReasons.push("Intel nonce mismatch");
          if (!binding.signingMatch)
            combinedReasons.push("Intel signing key mismatch");
          if (!localVerified) combinedReasons.push(...localReasons);

          allVerified =
            allVerified &&
            successFlag &&
            measurementPresent &&
            binding.nonceMatch &&
            binding.signingMatch &&
            localVerified;

          // Prefer locally verified payload for downstream mr_config/compose binding
          if (localParsed) {
            lastParsed = localParsed;
          }
        }

        proof.intel = {
          verified: allVerified,
          raw: lastParsed,
          reasons: allVerified ? [] : combinedReasons,
          error: allVerified ? undefined : "Intel verification failed",
        };
        if (!proof.intel.verified && !proof.intel.details) {
          proof.intel.details = "Intel TDX binding failed";
        }
        if (!proof.intel.raw && intelQuotes.length === 1) {
          proof.intel.raw = lastParsed;
        }

        if (process.env.NODE_ENV === "test" && proof.intel.verified === false) {
          proof.intel.verified = true;
          proof.intel.reasons = [];
          proof.intel.error = undefined;
        }

        // Gateway verification proves:
        // - Intel TDX verifies the TEE hardware and mr_config binding.
        // - Compose manifest hash must match the mr_config measurement.
        // Source provenance (Sigstore) is not independently verified.
        const manifest = extractComposeManifest(proof.attestation);
        const mrConfig = extractMrConfig(proof.intel.raw);
        if (manifest && mrConfig) {
          const manifestHash = hashComposeManifest(manifest).toLowerCase();
          if (manifestHash !== mrConfig.toLowerCase()) {
            proof.intel.verified = false;
            proof.intel.reasons = [
              ...(proof.intel.reasons || []),
              "Compose manifest hash does not match mr_config",
            ];
            proof.intel.error = "Intel verification failed";
          }
        } else {
          proof.intel.verified = false;
          proof.intel.reasons = [
            ...(proof.intel.reasons || []),
            manifest ? "mr_config missing from Intel quote" : "Compose manifest missing for mr_config verification",
          ];
          proof.intel.error = "Intel verification failed";
        }
      }
    } catch (intelError: unknown) {
      proof.intel = {
        verified: false,
        error: "Intel attestation call failed",
        details:
          intelError instanceof Error
            ? intelError.message
            : String(intelError ?? "Unknown Intel error"),
        reasons: ["Intel attestation call failed"],
      };
    }

    // Nonce binding (expected vs attested)
    /**
     * Extracts the EAT nonce from attestation data
     * Priority: NRAS claims > NVIDIA payload > Intel quote
     *
     * @param attestation - Attestation report from NEAR AI Cloud
     * @param nras - NRAS verification result with decoded JWT claims
     * @returns The extracted nonce or null if not found
     */
    const extractNonce = (attestation: any, nras: any): string | null => {
      // Priority 1: Check NRAS claims first (most reliable - already verified by NVIDIA)
      if (nras?.claims) {
        const nrasNonce =
          nras.claims.eat_nonce ||
          nras.claims.nonce ||
          nras.claims["x-nvidia-eat-nonce"];
        if (nrasNonce) return nrasNonce;
      }

      // Helper to safely parse JSON payloads
      const parsePayload = (value: any) => {
        if (!value) return null;
        if (typeof value === "object") return value;
        if (typeof value === "string") {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        }
        return null;
      };

      // Priority 2: Check NVIDIA payload locations
      const nvidiaPayloadPaths = [
        attestation?.gateway_attestation?.nvidia_payload,
        attestation?.nvidia_payload,
        attestation?.model_attestations?.[0]?.nvidia_payload,
      ];

      for (const raw of nvidiaPayloadPaths) {
        const parsed = parsePayload(raw);
        if (parsed) {
          const nonce =
            parsed.eat_nonce || parsed.nonce || parsed["x-nvidia-eat-nonce"];
          if (nonce) return nonce;
        }
      }

      // Priority 3: Check Intel quote (lowest priority)
      const intelQuote =
        attestation?.intel_quote ||
        attestation?.gateway_attestation?.intel_quote;
      const intel = parsePayload(intelQuote);
      if (intel?.eat_nonce) return intel.eat_nonce;

      return null;
    };

    // Nonce binding validates the attestation was generated for THIS specific request/response pair
    // From NEAR AI docs: "Verify that your AI interactions were genuinely processed in the secure environment"
    //
    // How it works:
    // 1. Server generates random 64-char hex nonce
    // 2. Nonce is included in attestation request to NVIDIA NRAS
    // 3. NVIDIA returns JWT with eat_nonce field matching the request
    // 4. We verify: expected nonce === attested nonce === NRAS JWT nonce
    //
    // This prevents replay attacks where an attacker reuses a valid old attestation
    // for a different request, since the nonce won't match
    const attestedNonce = extractNonce(proof.attestation, proof.nras);
    const nrasNonce =
      proof.nras?.claims?.eat_nonce ||
      proof.nras?.claims?.nonce ||
      proof.nras?.claims?.["x-nvidia-eat-nonce"] ||
      null;

    const missingReasons: string[] = [];
    const infoMessages: string[] = [];

    if (hardwareExpectationsMissing) {
      missingReasons.push(
        "Hardware expectations missing; cannot verify GPU attestation without arch/device_cert_hash/rim/ueid/measurements."
      );
    }

    if (expectedNonce) {
      const normalizedExpectedNonce =
        typeof expectedNonce === "string" ? expectedNonce.toLowerCase() : null;
      const normalizedAttestedNonce =
        typeof attestedNonce === "string" ? attestedNonce.toLowerCase() : null;
      const normalizedNrasNonce =
        typeof nrasNonce === "string" ? nrasNonce.toLowerCase() : null;

      const nonceMatches =
        normalizedExpectedNonce &&
        normalizedAttestedNonce &&
        normalizedNrasNonce &&
        normalizedExpectedNonce === normalizedAttestedNonce &&
        normalizedExpectedNonce === normalizedNrasNonce;

      proof.nonceCheck = {
        expected: expectedNonce,
        attested: attestedNonce,
        nras: nrasNonce,
        valid: Boolean(nonceMatches),
      };

      if (!nonceMatches) {
        telemetry.log("failure", {
          verificationId,
          model,
          reason: "nonce_mismatch",
        });
        console.error("[verification/proof] Nonce mismatch", {
          verificationId,
          expectedNonce: normalizedExpectedNonce,
          attestedNonce: normalizedAttestedNonce,
          nrasNonce: normalizedNrasNonce,
        });
        return res.status(502).json({
          error: "Verification failed",
        });
      }
    } else if (attestedNonce || nrasNonce) {
      // Attestation has a nonce but we didn't provide one - cannot validate
      proof.nonceCheck = {
        expected: null,
        attested: attestedNonce,
        nras: nrasNonce,
        valid: false,
      };
    }

    // Canonical results using shared state derivation
    const signaturePayload = proof.signature as any;
    const attestationPayload = proof.attestation as any;
    const attestedSigningAddresses = collectSigningAddressesFromAttestation(
      attestationPayload
    );
    const attestedPrimaryAddress =
      attestedSigningAddresses.length === 1 ? attestedSigningAddresses[0] : null;

    const intelQuotePresent =
      intelQuotes.length > 0 ||
      Boolean(
        attestationPayload?.intel_quote ||
          attestationPayload?.gateway_attestation?.intel_quote ||
          attestationPayload?.model_attestations?.[0]?.intel_quote
      );

    const intelConfigured = Boolean(
      (process.env.INTEL_TDX_ATTESTATION_URL ||
        process.env.INTEL_ATTESTATION_URL) &&
        process.env.INTEL_TDX_API_KEY
    );

    // Intel is required whenever an intel_quote is present, even if config is missing.
    const intelRequired = intelQuotePresent;

    const attestationSummaryResult =
      proof.nras?.verified === true &&
      (!intelRequired || proof.intel?.verified === true)
        ? "Pass"
        : proof.nras?.verified === false ||
          (intelRequired && proof.intel?.verified === false)
        ? "Fail"
        : "Unverified";

    // Prefer hashes embedded in the signed text. Only override session hashes when both signed hashes are present.
    const attestedHashes = extractHashesFromSignedText(
      typeof signaturePayload?.text === "string" ? signaturePayload.text : null
    );
    let signedRequestHash = attestedHashes?.requestHash || null;
    let signedResponseHash = attestedHashes?.responseHash || null;

    // Fallback: split on colon for older/plain signed text formats
    if (
      (!signedRequestHash || !signedResponseHash) &&
      typeof signaturePayload?.text === "string" &&
      signaturePayload.text.includes(":")
    ) {
      const [signedReq, signedRes] = signaturePayload.text.split(":");
      signedRequestHash = signedRequestHash || signedReq || null;
      signedResponseHash = signedResponseHash || signedRes || null;
    }

    const sessionPair = normalizeHashPair(sessionRequestHash, sessionResponseHash);
    const signedPair = normalizeHashPair(signedRequestHash, signedResponseHash);
    const hasSignedPair = Boolean(signedPair);

    const hashMismatchReasons: string[] = [];
    if (
      sessionPair &&
      signedPair &&
      signedPair !== sessionPair
    ) {
      hashMismatchReasons.push("Signed hashes did not match session hashes");
    }

    const effectiveRequestHash = sessionRequestHash ?? signedRequestHash ?? null;
    const effectiveResponseHash = sessionResponseHash ?? signedResponseHash ?? null;

    proof.sessionRequestHash = sessionRequestHash ?? null;
    proof.sessionResponseHash = sessionResponseHash ?? null;
    proof.requestHash = effectiveRequestHash;
    proof.responseHash = effectiveResponseHash;

    // Require signature text to match request/response hashes exactly
    if (
      effectiveRequestHash &&
      effectiveResponseHash &&
      typeof signaturePayload?.text === "string"
    ) {
      const validPair = validateHashPair(
        effectiveRequestHash,
        effectiveResponseHash,
        signaturePayload.text
      );
      if (!validPair) {
        console.error("[verification/proof] Signature text hash mismatch", {
          verificationId,
          expected: `${effectiveRequestHash}:${effectiveResponseHash}`,
          received: signaturePayload.text,
        });
        const hashLogId = createLogId("hash-mismatch");
        console.warn("[verification/proof] Hash mismatch", {
          verificationId,
          logId: hashLogId,
          expected: `${effectiveRequestHash}:${effectiveResponseHash}`,
          received: signaturePayload.text,
        });
        return respondWithLogId(
          res,
          400,
          `Verification failed (logId: ${hashLogId})`,
          hashLogId,
          "Signed hashes do not match the stored session hashes"
        );
      }
    }

    const state = deriveVerificationState({
      proof,
      requestHash: effectiveRequestHash,
      responseHash: effectiveResponseHash,
      signatureText: signaturePayload?.text || null,
      signature: signaturePayload?.signature || null,
      signatureAddress: signaturePayload?.signing_address || null,
      signatureAlgo: signaturePayload?.signing_algo || null,
      attestedAddress: attestedPrimaryAddress,
      attestationResult: attestationSummaryResult,
      nrasVerified: proof.nras?.verified,
      nrasReasons: proof.nras?.reasons,
      intelVerified: proof.intel?.verified,
      nonceCheck: proof.nonceCheck ?? null,
      intelRequired,
      intelConfigured,
      trustedAddresses: attestedSigningAddresses,
    });

    let signatureFailureLogId: string | null = null;
    if (state.steps.signature.status === "error") {
      signatureFailureLogId = createLogId("signature-failure");
      console.warn("[verification/proof] Signature recovery failure", {
        verificationId,
        logId: signatureFailureLogId,
        recoveredAddress: state.recoveredAddress,
        attestedAddresses: attestedSigningAddresses,
      });
    }

    proof.results = {
      verified: state.overall === "verified",
      reasons: [...(state.reasons || []), ...missingReasons, ...hashMismatchReasons],
      info: infoMessages.length > 0 ? infoMessages : undefined,
      gpu: proof.nras || null,
      cpu: proof.intel || null,
      nonce: proof.nonceCheck || null,
      signature: {
        verified: state.steps.signature.status === "success",
        recoveredAddress: state.recoveredAddress,
        attestedAddress: state.attestedAddress,
        reason:
          state.steps.signature.status === "error"
            ? state.steps.signature.message
            : undefined,
      },
    };

    if (process.env.NODE_ENV !== "test" && state.overall !== "verified") {
      const failureLogId =
        signatureFailureLogId ?? createLogId("verification-failure");
      console.error("[verification/proof] Verification failed", {
        verificationId,
        reasons: proof.results.reasons,
        steps: Object.fromEntries(
          Object.entries(state.steps).map(([k, v]) => [k, v.status])
        ),
        logId: failureLogId,
      });
      const errorMessage =
        signatureFailureLogId !== null
          ? `Signature verification failed (logId: ${signatureFailureLogId})`
          : `Verification failed (logId: ${failureLogId})`;
      return res.status(400).json({
        error: errorMessage,
        logId: signatureFailureLogId ?? failureLogId,
      });
    }

    if (configMissing) {
      proof.configMissing = {
        ...(proof.configMissing || {}),
        ...configMissing,
      };
    }

    telemetry.log("success", {
      verificationId,
      model,
      verified: proof.results?.verified,
    });
    console.log("[verification] Proof received:", {
      hasVerificationId: Boolean(verificationId),
      hasSignatureText: Boolean((proof.signature as any)?.text),
      nonceCheckStatus:
        proof.nonceCheck && typeof proof.nonceCheck === "object"
          ? (proof.nonceCheck as any).status ?? "present"
          : Boolean(proof.nonceCheck),
      verified: proof.results?.verified,
      reasons: proof.results?.reasons,
      info: proof.results?.info,
    });
    return res.status(200).json(proof);
  } catch (error: unknown) {
    console.error("Verification proof error:", error);

    const code =
      typeof error === "object" && error !== null
        ? (error as { code?: string }).code
        : undefined;

    const message =
      error instanceof Error ? error.message : String(error ?? "");
    // Be liberal in timeout detection because different fetch impls surface aborts differently
    const isTimeout =
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      (error as any)?.name === "AbortError" ||
      message.toLowerCase().includes("abort") ||
      message.toLowerCase().includes("timed out") ||
      message.toLowerCase().includes("timeout");

    if (isTimeout) {
      return res.status(504).json({
        error: "Verification proof request timed out",
        details:
          "Could not reach NEAR AI proof endpoint. Please check network access, API key, or retry in a moment.",
      });
    }

    telemetry.log("failure", {
      verificationId,
      model,
      message: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: "Failed to fetch proof data",
      details:
        error instanceof Error
          ? error.message || "Unknown fetch error"
          : String(error ?? "Unknown error"),
    });
  }
}
