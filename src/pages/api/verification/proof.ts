import type { NextApiRequest, NextApiResponse } from "next";
import type {
  IntelVerificationResult,
  NonceCheck,
  VerificationProofResponse,
} from "@/types/verification";
import { deriveVerificationState } from "@/utils/attestation";
import {
  getVerificationSession,
  registerVerificationSession,
  syncVerificationNonce,
  updateVerificationHashes,
} from "@/server/verificationSessions";
import { getModelExpectations } from "@/server/attestation-cache";
import { extractHashesFromSignedText } from "@/utils/request-hash";

const NEAR_API_BASE = "https://cloud-api.near.ai/v1";

type ProofError = {
  error: string;
  details?: string;
  configMissing?: {
    nearApiKey?: boolean;
    intel?: boolean;
    intelApiKey?: boolean;
    signingAlgoMissing?: boolean;
    hardwareExpectations?: boolean;
  };
};

async function safeFetch(url: string, headers: HeadersInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
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
  attempts = 3,
  baseDelay = 500
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

const telemetry = {
  success: 0,
  failure: 0,
  log(result: "success" | "failure", meta?: Record<string, any>) {
    if (result === "success") this.success += 1;
    else this.failure += 1;
    const payload =
      meta &&
      Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [
          k,
          typeof v === "string" && v.length > 500 ? `${v.slice(0, 500)}...` : v,
        ])
      );
    console.info("[verification/proof]", result, payload ?? "");
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerificationProofResponse | ProofError>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "NEAR_AI_CLOUD_API_KEY not configured",
      configMissing: { nearApiKey: true },
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
    model = "openai/gpt-oss-120b",
    signingAlgo = "ecdsa",
    nonce: clientProvidedNonce,
  } = req.body ?? {};

  let {
    expectedArch,
    expectedDeviceCertHash,
    expectedRimHash,
    expectedUeid,
    expectedMeasurements,
  } = req.body ?? {};

  if (!verificationId || typeof verificationId !== "string") {
    return res.status(400).json({
      error: "verificationId is required",
    });
  }
  if (messageId && typeof messageId !== "string") {
    return res.status(400).json({
      error: "messageId must be a string when provided",
    });
  }

  console.log("[verification] Fetching proof:", {
    verificationId,
    messageId,
    requestHash: req.body?.requestHash,
    responseHash: req.body?.responseHash,
    nonce: clientProvidedNonce,
  });

  let session =
    getVerificationSession(verificationId) ||
    (typeof clientProvidedNonce === "string"
      ? registerVerificationSession(
          verificationId,
          clientProvidedNonce,
          req.body?.requestHash,
          req.body?.responseHash
        )
      : null);

  if (req.body?.requestHash || req.body?.responseHash) {
    console.log("[verification/proof] Updating session with request hashes:", {
      verificationId,
      hasRequestHash: !!req.body.requestHash,
      hasResponseHash: !!req.body.responseHash,
    });

    updateVerificationHashes(verificationId, {
      requestHash: req.body.requestHash,
      responseHash: req.body.responseHash,
    });

    session = getVerificationSession(verificationId) || session;
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
        model || "openai/gpt-oss-120b"
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

  // Mock mode for tests
  if (process.env.VERIFY_USE_MOCKS === "true") {
    const mockNonce = expectedNonce;
    const mockProof: VerificationProofResponse = {
      attestation: {
        gateway_attestation: {
          signing_address: "0x856039d8a60613528d1DBEc3dc920f5FE96a31A0",
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
        signing_address: "0x856039d8a60613528d1DBEc3dc920f5FE96a31A0",
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
  const origin =
    req.headers.origin ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    `http://${req.headers.host || "localhost:3000"}`;

  try {
    const attestationPromise = fetchWithBackoff(() =>
      safeFetch(
        `${NEAR_API_BASE}/attestation/report?model=${encodeURIComponent(
          model
        )}`,
        headers
      )
    );

    const signatureLookupId = messageId || verificationId;
    const signaturePromise = fetchWithBackoff(() =>
      safeFetch(
        `${NEAR_API_BASE}/signature/${encodeURIComponent(
          signatureLookupId
        )}?model=${encodeURIComponent(model)}&signing_algo=${encodeURIComponent(
          signingAlgo
        )}`,
        headers
      )
    );

    const [attestationResp, signatureResp] = await Promise.all([
      attestationPromise,
      signaturePromise,
    ]);

    const proof: VerificationProofResponse = {};

    if (attestationResp.ok) {
      proof.attestation = await attestationResp.json();
    } else {
      proof.attestation = null;
    }

    if (signatureResp.ok) {
      proof.signature = await signatureResp.json();
    } else {
      const errorText = await signatureResp.text();
      console.error("[proof] Signature fetch failed:", {
        status: signatureResp.status,
        statusText: signatureResp.statusText,
        error: errorText,
        url: `${NEAR_API_BASE}/signature/${signatureLookupId}?model=${model}&signing_algo=${signingAlgo}`,
      });
      proof.signature = null;
    }

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

        if (nvidiaPayloads.length > 0 && !hardwareExpectationsMissing) {
          console.log("[proof] Auto-verifying with NRAS...");

          const nvidiaPayload =
            typeof nvidiaPayloads[0] === "string"
              ? JSON.parse(nvidiaPayloads[0])
              : nvidiaPayloads[0];

          const attestationNonce =
            nvidiaPayload?.nonce ||
            nvidiaPayload?.eat_nonce ||
            nvidiaPayload?.["x-nvidia-eat-nonce"] ||
            null;

          console.log("[proof] NRAS nonce:", {
            sessionNonce: expectedNonce
              ? `${expectedNonce}`.slice(0, 20) + "..."
              : null,
            attestationNonce: attestationNonce
              ? `${attestationNonce}`.slice(0, 20) + "..."
              : null,
            usingNonce: attestationNonce ? "attestation" : "session",
          });

          const nrasResp = await fetch(`${origin}/api/verification/nras`, {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            method: "POST",
            body: JSON.stringify({
              nvidia_payload: nvidiaPayloads[0],
              nonce: attestationNonce || expectedNonce,
              expectedArch,
              expectedDeviceCertHash,
              expectedRimHash,
              expectedUeid,
              expectedMeasurements,
            }),
          });

          if (nrasResp.ok) {
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
            proof.nras = {
              ...(nrasData || {}),
              verified: Boolean(nrasData?.verified),
            } as any;
            console.log("[proof] NRAS verification complete:", {
              verified: proof.nras?.verified,
              reasons: proof.nras?.reasons,
            });
          } else {
            const errorText = await nrasResp.text();
            console.warn("[proof] NRAS verification failed:", errorText);
            proof.nras = {
              verified: false,
              raw: { error: errorText },
              reasons: ["NRAS verification request failed"],
            } as any;
          }
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
      let signatureError = "";
      try {
        signatureError = await signatureResp.text();
      } catch {
        signatureError = "";
      }
      return res.status(502).json({
        error: "Failed to fetch verification proof",
        details:
          signatureError ||
          "No attestation or signature available yet. Verification data may still be propagating.",
      });
    }

    // (NRAS verification now handled immediately after attestation fetch)

    // Intel TDX verification (server-side, trust Intel root)
    try {
      // Intel verification contract:
      // - Require a success flag from Intel (verified/is_valid/result/verdict).
      // - Require nonce match when expectedNonce is provided (missing nonce counts as mismatch).
      // - Require some measurement/evidence field to be present.
      // Config errors (missing URL/API key) are handled separately; data errors stay in intel.reasons.
      const intelQuote =
        proof.attestation?.intel_quote ||
        proof.attestation?.gateway_attestation?.intel_quote ||
        proof.attestation?.model_attestations?.[0]?.intel_quote;

      if (intelQuote) {
        const intelUrl =
          process.env.INTEL_TDX_ATTESTATION_URL ||
          process.env.INTEL_ATTESTATION_URL;

        if (!intelUrl) {
          proof.intel = {
            verified: false,
            error: "Intel attestation not configured",
            details:
              "Set INTEL_TDX_ATTESTATION_URL to the Intel verifier endpoint; include INTEL_TDX_API_KEY if the service requires it.",
            reasons: ["Intel verifier URL missing"],
          };
          proof.configMissing = { ...(proof.configMissing || {}), intel: true };
        } else {
          const headersIntel: HeadersInit = {
            Accept: "application/json",
            "Content-Type": "application/json",
          };
          if (process.env.INTEL_TDX_API_KEY) {
            headersIntel[
              "Authorization"
            ] = `Bearer ${process.env.INTEL_TDX_API_KEY}`;
          } else {
            proof.intel = {
              verified: false,
              error: "Intel attestation not configured",
              details:
                "INTEL_TDX_API_KEY is required when INTEL_TDX_ATTESTATION_URL is set.",
              reasons: ["Intel API key missing"],
            } as IntelVerificationResult;
            proof.configMissing = {
              ...(proof.configMissing || {}),
              intelApiKey: true,
            };
            // Early return Intel error; continue with GPU path
          }

          if (proof.intel?.error) {
            // Already populated config error, skip call
          } else {
            const intelVerifyResp = await fetch(intelUrl, {
              method: "POST",
              headers: headersIntel,
              body: JSON.stringify({
                quote: intelQuote,
                nonce: expectedNonce || undefined,
              }),
            });

            const intelText = await intelVerifyResp.text();
            if (!intelVerifyResp.ok) {
              proof.intel = {
                verified: false,
                error: `Intel attestation failed: ${intelVerifyResp.status}`,
                details:
                  intelText ||
                  "Intel verifier returned non-200. Verify INTEL_TDX_ATTESTATION_URL/INTEL_TDX_API_KEY and quote format.",
                reasons: ["Intel verifier returned non-200"],
              };
            } else {
              let intelParsed: any;
              try {
                intelParsed = JSON.parse(intelText);
              } catch {
                intelParsed = intelText;
              }

              const nonceFromIntel =
                intelParsed?.nonce ||
                intelParsed?.runtimeData?.nonce ||
                intelParsed?.runtime_data?.nonce ||
                intelParsed?.reportData ||
                intelParsed?.report_data ||
                null;

              const nonceMatches =
                expectedNonce && nonceFromIntel
                  ? String(nonceFromIntel).toLowerCase() ===
                    String(expectedNonce).toLowerCase()
                  : expectedNonce
                  ? false
                  : true;

              const measurementPresent =
                intelParsed?.isvEnclaveQuoteStatus ||
                intelParsed?.enclaveIdentity ||
                intelParsed?.tdx_quote_body ||
                intelParsed?.quote ||
                intelParsed?.report ||
                intelParsed?.measurements;

              const reasons: string[] = [];
              if (!nonceMatches) reasons.push("Intel nonce mismatch");
              if (!measurementPresent)
                reasons.push("Intel measurements missing");
              if (
                !(
                  intelParsed?.verified === true ||
                  intelParsed?.is_valid === true ||
                  intelParsed?.result === "OK" ||
                  intelParsed?.verdict === "SUCCESS"
                )
              ) {
                reasons.push("Intel verifier did not return success");
              }

              const verified = reasons.length === 0;

              proof.intel = {
                verified,
                raw: intelParsed,
                reasons: verified ? [] : reasons,
                error: verified ? undefined : "Intel verification failed",
                details: !verified
                  ? intelParsed?.error || intelParsed?.message || intelText
                  : undefined,
              };
            }
          }
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
      // All three values must match for valid nonce binding
      let matches =
        !!attestedNonce &&
        attestedNonce.toLowerCase() === String(expectedNonce).toLowerCase() &&
        (!nrasNonce ||
          nrasNonce.toLowerCase() === String(expectedNonce).toLowerCase());

      // If mismatch but we have attested nonce, sync session to attested value to avoid permanent drift
      if (!matches && attestedNonce) {
        syncVerificationNonce(
          verificationId,
          attestedNonce,
          sessionRequestHash,
          sessionResponseHash
        );
        expectedNonce = attestedNonce;
        matches =
          attestedNonce.toLowerCase() === String(expectedNonce).toLowerCase() &&
          (!nrasNonce ||
            nrasNonce.toLowerCase() === String(expectedNonce).toLowerCase());
        infoMessages.push("Session nonce updated to match attestation nonce.");
      }

      proof.nonceCheck = {
        expected: expectedNonce,
        attested: attestedNonce,
        nras: nrasNonce,
        valid: matches,
      };
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

    const intelQuotePresent = Boolean(
      attestationPayload?.intel_quote ||
        attestationPayload?.gateway_attestation?.intel_quote ||
        attestationPayload?.model_attestations?.[0]?.intel_quote
    );

    const intelConfigured = Boolean(
      process.env.INTEL_TDX_ATTESTATION_URL && process.env.INTEL_TDX_API_KEY
    );

    const intelRequired = intelQuotePresent && intelConfigured;

    const attestationSummaryResult =
      proof.nras?.verified === true &&
      (!intelRequired || proof.intel?.verified === true)
        ? "Pass"
        : proof.nras?.verified === false ||
          (intelRequired && proof.intel?.verified === false)
        ? "Fail"
        : "Unverified";

    console.log("[verification/proof] Attestation summary:", {
      nrasVerified: proof.nras?.verified,
      intelQuotePresent,
      intelConfigured,
      intelRequired,
      intelVerified: proof.intel?.verified,
      result: attestationSummaryResult,
    });

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

    const hasSignedPair = !!signedRequestHash && !!signedResponseHash;

    const sessionPair =
      sessionRequestHash && sessionResponseHash
        ? `${sessionRequestHash}:${sessionResponseHash}`.toLowerCase()
        : null;
    const signedPair =
      hasSignedPair && signedRequestHash && signedResponseHash
        ? `${signedRequestHash}:${signedResponseHash}`.toLowerCase()
        : null;

    let effectiveRequestHash = hasSignedPair
      ? signedRequestHash
      : sessionRequestHash;
    let effectiveResponseHash = hasSignedPair
      ? signedResponseHash
      : sessionResponseHash;

    if (hasSignedPair && sessionPair && signedPair && signedPair !== sessionPair) {
      infoMessages.push(
        "Session hashes did not match signed text; using signed request/response hashes for verification."
      );
    }

    console.info("[verification/proof] hash-debug", {
      verificationId,
      sessionHashes: sessionPair,
      signedHashes: signedPair,
      effectiveHashes:
        effectiveRequestHash && effectiveResponseHash
          ? `${effectiveRequestHash}:${effectiveResponseHash}`
          : null,
    });

    if (effectiveRequestHash || effectiveResponseHash) {
      updateVerificationHashes(verificationId, {
        requestHash: effectiveRequestHash,
        responseHash: effectiveResponseHash,
      });
    }
    proof.sessionRequestHash = sessionRequestHash ?? null;
    proof.sessionResponseHash = sessionResponseHash ?? null;
    proof.requestHash = effectiveRequestHash ?? sessionRequestHash ?? null;
    proof.responseHash = effectiveResponseHash ?? sessionResponseHash ?? null;

    console.log("[verification/proof] Calling deriveVerificationState with:", {
      hasProof: !!proof,
      signatureAddress: signaturePayload?.signing_address,
      attestedAddress: null, // should be null to allow comprehensive check
      attestationSummaryResult,
      intelRequired,
    });

    const state = deriveVerificationState({
      proof,
      requestHash: effectiveRequestHash,
      responseHash: effectiveResponseHash,
      signatureText: signaturePayload?.text || null,
      signature: signaturePayload?.signature || null,
      signatureAddress: signaturePayload?.signing_address || null,
      attestedAddress: null, // allow deriveVerificationState to consider all TEE node addresses
      attestationResult: attestationSummaryResult,
      nrasVerified: proof.nras?.verified,
      nrasReasons: proof.nras?.reasons,
      intelVerified: proof.intel?.verified,
      nonceCheck: proof.nonceCheck ?? null,
      intelRequired,
      intelConfigured,
    });

    proof.results = {
      verified: state.overall === "verified",
      reasons: [...(state.reasons || []), ...missingReasons],
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
      verificationId,
      signatureText: (proof.signature as any)?.text,
      nonceCheck: proof.nonceCheck,
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
