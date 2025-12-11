import { useCallback, useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import { validateExpectations } from "@/utils/attestation/expectations";
import { deriveVerificationState } from "@/utils/attestation/state";
import {
  buildSignaturePayload,
  resolveEffectiveHash,
  resolveNvidiaPayloadForNras,
  buildNrasSummary,
  parseJsonPayload,
} from "@/utils/verification/proof-helpers";
import {
  fetchVerificationProof,
  verifyWithNrasService,
} from "@/services/verification/proof-service";
import type {
  VerificationMetadata,
  VerificationStatus,
} from "@/types/agui-events";
import type {
  NrasVerificationResult,
  PartialExpectations,
  RemoteProof,
  VerificationProofResponse,
} from "@/types/verification";
import {
  normalizeHashValue,
  decodeJwtPayload,
  normalizeVerificationResult,
  NormalizedVerificationResult,
} from "@/utils/verification/shared";
import { createVerificationAuthToken } from "@/utils/verification/auth";
import { useNear } from "@/hooks/useNear";
import { extractHashesFromSignedText } from "@/verification/hash-utils";

const buildAttestedHashes = (signatureText?: string | null) =>
  extractHashesFromSignedText(signatureText);

const coerceToString = (value: unknown) =>
  typeof value === "string" ? value : null;

const buildAttestationPayload = (att?: RemoteProof["attestation"]) => {
  if (!att) return null;
  const gateway = att.gateway_attestation ?? att;
  const modelAttestations = Array.isArray(att.model_attestations)
    ? att.model_attestations.filter(Boolean)
    : [];
  return {
    modelAttestation: modelAttestations[0] || null,
    modelAttestations,
    signingAddress:
      gateway.signing_address || gateway.signingAddress || gateway.key,
    signingAlgo:
      gateway.signing_algo ||
      gateway.signing_algorithm ||
      gateway.algorithm ||
      undefined,
    reportData: gateway.report_data || gateway.reportData,
    requestNonce: gateway.request_nonce || gateway.requestNonce,
    raw: gateway,
  };
};

const buildAttestationSummary = ({
  remoteProof,
  nrasData,
  normalized,
}: {
  remoteProof: RemoteProof | null;
  nrasData: NrasVerificationResult | null;
  normalized: NormalizedVerificationResult | null;
}) => {
  const nras = remoteProof?.nras || nrasData;

  const decodeLocalJwt = (token?: string | null) => decodeJwtPayload(token);

  const nrasClaims = (() => {
    if (nras?.claims) return nras.claims;
    if (nras?.gpus && typeof nras.gpus === "object") {
      const firstGpuToken = Object.values(nras.gpus)[0] as string | undefined;
      if (firstGpuToken) {
        return decodeLocalJwt(firstGpuToken);
      }
    }
    return null;
  })();

  if (!remoteProof && !nrasClaims) return null;
  if (!remoteProof?.attestation && !nrasClaims) return null;

  try {
    const att = remoteProof?.attestation ?? {};
    const modelAttestations = Array.isArray(att.model_attestations)
      ? att.model_attestations.filter(Boolean)
      : [];
    const primaryModelAttestation = modelAttestations[0] || null;
    const nvidiaPayload =
      primaryModelAttestation?.nvidia_payload ||
      att.nvidia_payload ||
      att.gateway_attestation?.nvidia_payload;
    const intelPayload =
      att.intel_quote ||
      att.gateway_attestation?.intel_quote ||
      primaryModelAttestation?.intel_quote;

    const nvidia = parseJsonPayload(nvidiaPayload);
    const intel = parseJsonPayload(intelPayload);
    const claims = nrasClaims || {};

    const perClaimSecboot = claims?.secboot === true || claims?.secboot === "enabled";
    const perClaimNonce =
      claims?.eat_nonce ||
      claims?.["x-nvidia-eat-nonce"] ||
      nvidia?.eat_nonce ||
      intel?.eat_nonce ||
      "";
    const secbootStatus =
      normalized?.claims?.secboot ?? Boolean(perClaimSecboot);
    const nonceValue = normalized?.claims?.nonce || perClaimNonce;
    const attResult =
      normalized?.claims?.overallResult ??
      (claims
        ? claims?.["x-nvidia-overall-att-result"] ??
          claims?.overall_result ??
          claims?.overall_pass
        : undefined);

    const hardwareFromVerifiedClaims = Boolean(
      normalized?.nrasVerified ?? remoteProof?.nras?.verified ?? nrasData?.verified
    );

    const nonceBound = remoteProof?.nonceCheck?.valid === true;

    const intelConfigured =
      !remoteProof?.configMissing?.intel &&
      !remoteProof?.configMissing?.intelApiKey;
    const intelQuotePresent = Boolean(
      intelPayload ||
        att.gateway_attestation?.intel_quote ||
        att.model_attestations?.[0]?.intel_quote
    );

    const gpuValidated = hardwareFromVerifiedClaims && nonceBound;

    const fallbackHardwareValidated =
      gpuValidated &&
      (intelQuotePresent && intelConfigured
        ? remoteProof?.intel?.verified === true
        : true);
    const hardwareValidated = normalized?.hardwareVerified ?? fallbackHardwareValidated;

    const safeValue = (value: any) => {
      if ((hardwareValidated || gpuValidated) && value) return value;
      return "Not available";
    };

    const backendAttestationResult =
      (remoteProof?.results as any)?.verified === true
        ? "Pass"
        : (remoteProof?.results as any)?.verified === false
        ? "Fail"
        : null;
    const normalizedReasons =
      normalized?.reasons ??
      remoteProof?.nras?.reasons ??
      nrasData?.reasons ??
      [];

    return {
      gpu: safeValue(
        claims?.hwmodel ||
          claims?.["x-nvidia-gpu-driver-version"] ||
          nvidia?.["x-nvidia-gpu-driver-version"] ||
          nvidia?.hwmodel ||
          intel?.hwmodel
      ),
      driver: safeValue(
        claims?.["x-nvidia-gpu-driver-version"] ||
          nvidia?.["x-nvidia-gpu-driver-version"]
      ),
      vbios: safeValue(
        claims?.["x-nvidia-gpu-vbios-version"] ||
          nvidia?.["x-nvidia-gpu-vbios-version"]
      ),
      nonce: hardwareFromVerifiedClaims ? nonceValue || "" : "",
      oem: safeValue(claims?.oemid || intel?.oemid || nvidia?.oemid),
      secboot: hardwareFromVerifiedClaims
        ? secbootStatus
          ? "Enabled"
          : "Disabled"
        : "Unverified",
      dbgstat: safeValue(
        claims?.dbgstat ||
          claims?.["x-nvidia-dbgstat"] ||
          nvidia?.dbgstat ||
          nvidia?.["x-nvidia-dbgstat"]
      ),
      attestationResult:
        backendAttestationResult ||
        (attResult === false ? "Fail" : hardwareValidated ? "Pass" : "Unverified"),
      hasHardwareDetails:
        (gpuValidated || hardwareValidated) &&
        Boolean(
          claims?.hwmodel ||
            claims?.["x-nvidia-gpu-driver-version"] ||
            claims?.["x-nvidia-gpu-vbios-version"] ||
            nvidia?.hwmodel ||
            nvidia?.["x-nvidia-gpu-driver-version"] ||
            nvidia?.["x-nvidia-gpu-vbios-version"]
        ),
      verifiedHardware: hardwareValidated,
      hardwareReason:
        !hardwareValidated && hardwareFromVerifiedClaims
          ? normalizedReasons.join("\n") ||
            (remoteProof?.intel && remoteProof.intel.verified === false
              ? "Intel verification failed"
              : "Hardware attestation incomplete")
          : !hardwareFromVerifiedClaims
          ? "NRAS verification missing"
          : undefined,
      gpuVerified: gpuValidated,
      intelConfigured,
      fullVerification: hardwareValidated,
    };
  } catch (error) {
    console.error("Failed to parse attestation summary:", error);
    return null;
  }
};

export interface UseVerificationProofParams {
  open: boolean;
  autoFetch?: boolean;
  verification?: VerificationMetadata;
  verificationId?: string;
  model?: string;
  requestHash?: string;
  responseHash?: string;
  nonce?: string;
  expectedArch?: string | null;
  expectedDeviceCertHash?: string | null;
  expectedRimHash?: string | null;
  expectedUeid?: string | null;
  expectedMeasurements?: string[] | null;
  prefetchedProof?: RemoteProof | null;
  signingAlgo?: string;
}

interface VerificationProofState {
  remoteProof: RemoteProof | null;
  loading: boolean;
  fetchError: string | null;
  nrasData: NrasVerificationResult | null;
  nrasLoading: boolean;
  nrasError: string | null;
  retrying: boolean;
}

type VerificationProofAction =
  | { type: "SET_PREFETCH"; proof: RemoteProof | null }
  | { type: "RESET_FETCH" }
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; proof: RemoteProof }
  | { type: "FETCH_ERROR"; error: string }
  | { type: "SET_REMOTE_PROOF"; proof: RemoteProof | null }
  | { type: "NRAS_START" }
  | { type: "NRAS_SUCCESS"; data: NrasVerificationResult | null }
  | { type: "NRAS_ERROR"; error: string }
  | { type: "SET_RETRYING"; value: boolean };

const createInitialState = (
  prefetchedProof: RemoteProof | null
): VerificationProofState => ({
  remoteProof: prefetchedProof,
  loading: false,
  fetchError: null,
  nrasData: null,
  nrasLoading: false,
  nrasError: null,
  retrying: false,
});

const reducer = (
  state: VerificationProofState,
  action: VerificationProofAction
): VerificationProofState => {
  switch (action.type) {
    case "SET_PREFETCH":
      return {
        ...state,
        remoteProof: action.proof,
        fetchError: null,
      };
    case "RESET_FETCH":
      return { ...state, remoteProof: null, fetchError: null, loading: false };
    case "FETCH_START":
      return { ...state, loading: true, fetchError: null };
    case "FETCH_SUCCESS":
      return {
        ...state,
        loading: false,
        fetchError: null,
        remoteProof: action.proof,
      };
    case "FETCH_ERROR":
      return { ...state, loading: false, fetchError: action.error };
    case "SET_REMOTE_PROOF":
      return { ...state, remoteProof: action.proof };
    case "NRAS_START":
      return { ...state, nrasLoading: true, nrasError: null };
    case "NRAS_SUCCESS":
      return {
        ...state,
        nrasLoading: false,
        nrasError: null,
        nrasData: action.data,
      };
    case "NRAS_ERROR":
      return { ...state, nrasLoading: false, nrasError: action.error };
    case "SET_RETRYING":
      return { ...state, retrying: action.value, fetchError: null };
    default:
      return state;
  }
};

export const useVerificationProof = ({
  open,
  autoFetch = false,
  verification,
  verificationId,
  model,
  requestHash,
  responseHash,
  nonce,
  expectedArch = null,
  expectedDeviceCertHash = null,
  expectedRimHash = null,
  expectedUeid = null,
  expectedMeasurements = null,
  prefetchedProof = null,
  signingAlgo,
}: UseVerificationProofParams) => {
  const [state, dispatch] = useReducer(reducer, prefetchedProof, createInitialState);
  const {
    remoteProof,
    loading,
    fetchError,
    nrasData,
    nrasLoading,
    nrasError,
    retrying,
  } = state;

  const signaturePayload = useMemo(
    () => buildSignaturePayload(remoteProof?.signature),
    [remoteProof?.signature]
  );

  const attestedHashes = useMemo(
    () => buildAttestedHashes(signaturePayload?.text),
    [signaturePayload?.text]
  );

  const effectiveRequestHash = useMemo(
    () =>
      resolveEffectiveHash(
        attestedHashes?.requestHash,
        remoteProof?.requestHash,
        requestHash
      ),
    [attestedHashes, remoteProof?.requestHash, requestHash]
  );

  const effectiveResponseHash = useMemo(
    () =>
      resolveEffectiveHash(
        attestedHashes?.responseHash,
        remoteProof?.responseHash,
        responseHash
      ),
    [attestedHashes, remoteProof?.responseHash, responseHash]
  );

  const localSignedText = useMemo(() => {
    if (!effectiveRequestHash || !effectiveResponseHash) return null;
    return `${effectiveRequestHash}:${effectiveResponseHash}`;
  }, [effectiveRequestHash, effectiveResponseHash]);

  const recordedRequestHash = useMemo(
    () =>
      remoteProof?.sessionRequestHash ||
      remoteProof?.requestHash ||
      requestHash ||
      null,
    [remoteProof?.sessionRequestHash, remoteProof?.requestHash, requestHash]
  );

  const recordedResponseHash = useMemo(
    () =>
      remoteProof?.sessionResponseHash ||
      remoteProof?.responseHash ||
      responseHash ||
      null,
    [remoteProof?.sessionResponseHash, remoteProof?.responseHash, responseHash]
  );

  const hashMismatch = useMemo(() => {
    const attestedRequest = normalizeHashValue(attestedHashes?.requestHash);
    const attestedResponse = normalizeHashValue(attestedHashes?.responseHash);
    const recordedRequest = normalizeHashValue(recordedRequestHash);
    const recordedResponse = normalizeHashValue(recordedResponseHash);

    if (
      !attestedRequest ||
      !attestedResponse ||
      !recordedRequest ||
      !recordedResponse
    ) {
      return false;
    }

    return (
      attestedRequest !== recordedRequest ||
      attestedResponse !== recordedResponse
    );
  }, [attestedHashes, recordedRequestHash, recordedResponseHash]);

  const attestationPayload = useMemo(
    () => buildAttestationPayload(remoteProof?.attestation),
    [remoteProof?.attestation]
  );

  const nrasSummary = useMemo(
    () => buildNrasSummary(remoteProof, nrasData),
    [remoteProof, nrasData]
  );

  const nvidiaPayloadForNras = useMemo(
    () => resolveNvidiaPayloadForNras(remoteProof?.attestation),
    [remoteProof?.attestation]
  );

  const proofForNormalization = useMemo(() => {
    if (remoteProof) {
      return {
        ...remoteProof,
        nras: remoteProof.nras ?? nrasData ?? null,
      } as VerificationProofResponse;
    }

    if (nrasData) {
      return { nras: nrasData } as VerificationProofResponse;
    }

    return null;
  }, [remoteProof, nrasData]);

  const normalizedVerification = useMemo(() => {
    if (!proofForNormalization) return null;
    return (
      proofForNormalization.normalized ??
      normalizeVerificationResult(proofForNormalization)
    );
  }, [proofForNormalization]);

  const attestationSummary = useMemo(
    () =>
      buildAttestationSummary({
        remoteProof,
        nrasData,
        normalized: normalizedVerification,
      }),
    [remoteProof, nrasData, normalizedVerification]
  );

  const expectationInput: PartialExpectations = useMemo(
    () => ({
      nonce: nonce ?? undefined,
      arch: expectedArch ?? undefined,
      deviceCertHash: expectedDeviceCertHash ?? undefined,
      rimHash: expectedRimHash ?? undefined,
      ueid: expectedUeid ?? undefined,
      measurements: expectedMeasurements ?? undefined,
    }),
    [
      nonce,
      expectedArch,
      expectedDeviceCertHash,
      expectedRimHash,
      expectedUeid,
      expectedMeasurements,
    ]
  );

  const expectationsValidation = useMemo(
    () => validateExpectations(expectationInput),
    [expectationInput]
  );

  const expectationsReady = expectationsValidation?.complete ?? false;

  const { walletSigner } = useNear();

  const signProofRequest = useCallback(async () => {
    if (!walletSigner) {
      throw new Error("Connect your NEAR wallet to fetch the verification proof.");
    }
    return createVerificationAuthToken({
      walletSigner,
      verificationId,
    });
  }, [verificationId, walletSigner]);

  const hasAttestedAddresses = useMemo(() => {
    const attestedFromVerification =
      (
        verification as { attestedAddresses?: string[] } | undefined
      )?.attestedAddresses;
    return Boolean(
      attestedFromVerification?.length ||
        remoteProof?.attestation?.model_attestations?.length ||
        remoteProof?.attestation?.gateway_attestation?.signing_address
    );
  }, [
    verification,
    remoteProof?.attestation?.gateway_attestation?.signing_address,
    remoteProof?.attestation?.model_attestations,
  ]);

  const intelQuote = useMemo(() => {
    const att = remoteProof?.attestation;
    if (!att) return null;

    return (
      coerceToString(att.gateway_attestation?.intel_quote) ??
      coerceToString(att.intel_quote) ??
      coerceToString(att.model_attestations?.[0]?.intel_quote)
    );
  }, [remoteProof]);

  const missingExpectations = useMemo(() => {
    const missing: string[] = [];
    if (hasAttestedAddresses) {
      return missing;
    }
    if (!expectationsValidation?.complete) {
      const missingFields = expectationsValidation?.missing ?? [];
      if (missingFields.includes("nonce") || !expectationInput.nonce)
        missing.push("nonce");
      if (missingFields.includes("arch") || !expectationInput.arch)
        missing.push("architecture");
      if (
        missingFields.includes("deviceCertHash") ||
        !expectationInput.deviceCertHash
      )
        missing.push("device cert hash");
      if (!expectationInput.rimHash) missing.push("RIM hash");
      if (missingFields.includes("measurements")) missing.push("measurements");
    }
    return missing;
  }, [expectationsValidation, expectationInput, hasAttestedAddresses]);

  const verifyWithNRAS = useCallback(async () => {
    if (!nvidiaPayloadForNras) {
      toast.error("Missing NVIDIA payload needed for NRAS verification");
      return;
    }

    dispatch({ type: "NRAS_START" });
    try {
      const data = await verifyWithNrasService({
        verificationId,
        payload: nvidiaPayloadForNras,
      });

      const verified = Boolean(data?.verified);

      dispatch({
        type: "NRAS_SUCCESS",
        data: {
          verified,
          jwt: data?.jwt,
          token: data?.jwt,
          claims: data?.claims,
          gpus: data?.gpus,
          reasons: data?.reasons,
          raw: data?.raw,
        },
      });

      toast.success(
        verified
          ? "NRAS verification succeeded"
          : "NRAS verification completed with warnings"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to verify with NRAS";
      dispatch({ type: "NRAS_ERROR", error: errorMessage });
      toast.error(errorMessage);
    }
  }, [nvidiaPayloadForNras, verificationId]);

  useEffect(() => {
    dispatch({ type: "SET_PREFETCH", proof: prefetchedProof ?? null });
  }, [prefetchedProof]);

  useEffect(() => {
    if (prefetchedProof) {
      return;
    }
    dispatch({ type: "RESET_FETCH" });
  }, [verificationId, prefetchedProof]);

  useEffect(() => {
    if (
      (!open && !autoFetch) ||
      remoteProof ||
      !verificationId ||
      !expectationsReady
    )
      return;

    const fetchProof = async () => {
      try {
        dispatch({ type: "FETCH_START" });

        const authToken = await signProofRequest();
        const proof = await fetchVerificationProof({
          verificationId,
          model,
          requestHash,
          responseHash,
          expectationInput,
          signingAlgo,
          authToken,
        });
        dispatch({ type: "FETCH_SUCCESS", proof });
      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message || "Unable to fetch proof"
            : "Unable to fetch proof";
        dispatch({ type: "FETCH_ERROR", error: errorMsg });
      }
    };

    fetchProof();
  }, [
    open,
    autoFetch,
    verificationId,
    model,
    requestHash,
    responseHash,
    remoteProof,
    expectationsReady,
    expectationInput,
    signingAlgo,
    signProofRequest,
  ]);

  const hasAnyData = useMemo(
    () =>
      Boolean(
        verification ||
          verificationId ||
          requestHash ||
          responseHash ||
          remoteProof
      ),
    [verification, verificationId, requestHash, responseHash, remoteProof]
  );

  const canExportProof = Boolean(
    verificationId || requestHash || responseHash || verification || remoteProof
  );

  const hasInlineProof = Boolean(
    verification?.proof ||
      verification?.signature ||
      verification?.attestationReport ||
      verification?.measurement
  );

  const nrasVerified =
    normalizedVerification?.nrasVerified ??
    remoteProof?.nras?.verified ??
    nrasData?.verified;
  const nrasReasons =
    normalizedVerification?.reasons ??
    remoteProof?.nras?.reasons ??
    nrasData?.reasons;

  const verificationState = useMemo(() => {
    const intelQuotePresent = Boolean(
      attestationPayload?.raw?.intel_quote ||
      attestationPayload?.raw?.gateway_attestation?.intel_quote ||
        attestationPayload?.modelAttestation?.intel_quote
    );

    const intelConfigured =
      !remoteProof?.configMissing?.intel &&
      !remoteProof?.configMissing?.intelApiKey;

    const intelRequired = intelQuotePresent && intelConfigured;

    return deriveVerificationState({
      proof: remoteProof,
      requestHash: effectiveRequestHash,
      responseHash: effectiveResponseHash,
      signatureText: signaturePayload?.text || null,
      signature: signaturePayload?.signature || null,
      signatureAddress: signaturePayload?.signing_address || null,
      attestedAddress:
        (
          verification as { attestedAddresses?: string[] } | undefined
        )?.attestedAddresses?.[0] ?? null,
      attestationResult: attestationSummary?.attestationResult || null,
      nrasVerified: nrasVerified ?? undefined,
      nrasReasons: nrasReasons ?? undefined,
      intelVerified: remoteProof?.intel?.verified,
      nonceCheck: remoteProof?.nonceCheck ?? null,
      intelRequired,
      intelConfigured,
      normalizedVerification,
    });
  }, [
    normalizedVerification,
    remoteProof,
    nrasVerified,
    nrasReasons,
    effectiveRequestHash,
    effectiveResponseHash,
    signaturePayload?.text,
    signaturePayload?.signature,
    signaturePayload?.signing_address,
    attestationPayload?.raw?.intel_quote,
    attestationPayload?.raw?.gateway_attestation?.intel_quote,
    attestationPayload?.modelAttestation?.intel_quote,
    attestationSummary?.attestationResult,
    verification,
  ]);

  const derivedStatus: VerificationStatus = useMemo(() => {
    if (!remoteProof && !verification) return "pending";
    if (loading)
      return "pending";

    if (verification?.status && verification.status !== "pending") {
      return verification.status;
    }

    if (verificationState.overall === "verified") return "verified";
    if (verificationState.overall === "failed") return "failed";

    return verification?.status ?? "pending";
  }, [
    loading,
    verificationState.overall,
    remoteProof,
    verification,
  ]);

  const verificationSections = useMemo(() => {
    const steps = verificationState.steps;

    const getSectionStatus = (stepKeys: Array<keyof typeof steps>) => {
      const statuses = stepKeys.map((key) => steps[key].status);
      if (statuses.some((s) => s === "error")) return "error";
      if (statuses.every((s) => s === "success")) return "success";
      if (statuses.some((s) => s === "pending")) return "pending";
      return "pending";
    };

    return [
      {
        title: "Hardware Attestation",
        description: "Cryptographic proof from secure hardware",
        icon: null,
        status: getSectionStatus(["gpu", "cpu", "attestation"]),
        checks: [
          {
            name: "GPU Verification",
            status: steps.gpu.status === "pending" ? "idle" : steps.gpu.status,
            message: steps.gpu.message,
            details: steps.gpu.details,
            badge: "NVIDIA NRAS",
          },
          {
            name: "CPU Verification",
            status: steps.cpu.status === "pending" ? "idle" : steps.cpu.status,
            message: steps.cpu.message,
            details: steps.cpu.details,
            badge: "Intel TDX",
          },
          {
            name: "Overall Attestation",
            status:
              steps.attestation.status === "pending"
                ? "idle"
                : steps.attestation.status,
            message: steps.attestation.message,
            details: steps.attestation.details,
          },
        ],
      },
      {
        title: "Message Signature",
        description: "TEE signed the request and response",
        icon: null,
        status: getSectionStatus(["signature", "address", "hash"]),
        checks: [
          {
            name: "Signature Valid",
            status:
              steps.signature.status === "pending"
                ? "idle"
                : steps.signature.status,
            message: steps.signature.message,
            details: steps.signature.details,
            badge: "ECDSA",
          },
          {
            name: "Address Matches",
            status:
              steps.address.status === "pending"
                ? "idle"
                : steps.address.status,
            message: steps.address.message,
            details: steps.address.details,
          },
          {
            name: "Hashes Match",
            status:
              steps.hash.status === "pending" ? "idle" : steps.hash.status,
            message: steps.hash.message,
            details: steps.hash.details,
            badge: "SHA-256",
          },
        ],
      },
      {
        title: "Nonce Binding",
        description: "Prevents replay attacks",
        icon: null,
        status: steps.nonce.status === "pending" ? "idle" : steps.nonce.status,
        checks: [
          {
            name: "Anti-Replay Protection",
            status:
              steps.nonce.status === "pending" ? "idle" : steps.nonce.status,
            message: steps.nonce.message,
            details: steps.nonce.details,
          },
        ],
      },
    ];
  }, [verificationState.steps]);

  const attestationNodes = useMemo(
    () =>
      remoteProof?.attestationNodes?.map((node) => ({
        ...node,
        nrasVerified: node.nras?.verified,
        intelVerified: node.intel?.verified,
      })) ?? [],
    [remoteProof?.attestationNodes]
  );

  const signatureBinding = useMemo(() => {
    const signingAddress = signaturePayload?.signing_address?.toLowerCase() ?? null;
    if (!signingAddress) {
      return {
        matches: false,
        reason: "No signing address available yet",
      };
    }
    const addresses = Array.from(
      new Set(
        attestationNodes
          .map((node) => node.signingAddress ?? "")
          .filter((addr) => Boolean(addr))
          .map((addr) => addr.toLowerCase())
      )
    );
    if (!addresses.length) {
      return {
        matches: true,
        reason: "No attested nodes to compare against",
      };
    }
    const matches = addresses.includes(signingAddress);
    return {
      matches,
      reason: matches
        ? "Signature matches an attested node"
        : "Signature does not match any attested node",
    };
  }, [attestationNodes, signaturePayload?.signing_address]);

  const retryFetch = () => {
    dispatch({ type: "SET_RETRYING", value: true });
    dispatch({ type: "RESET_FETCH" });
    setTimeout(() => dispatch({ type: "SET_RETRYING", value: false }), 300);
  };

  const exportProof = useCallback(() => {
    if (!canExportProof) return;

    const payload = {
      metadata: {
        exportedAt: new Date().toISOString(),
        verificationId: verificationId || null,
        model: model || null,
      },
      hashes: {
        request: effectiveRequestHash || null,
        response: effectiveResponseHash || null,
        combined: localSignedText || null,
        recordedRequest: requestHash || null,
        recordedResponse: responseHash || null,
      },
      verification: {
        inline: verification || null,
        status: derivedStatus,
        steps: verificationSections,
      },
      proof: {
        attestation: remoteProof?.attestation || null,
        signature: signaturePayload || null,
        attestationSummary: attestationSummary || null,
      },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = verificationId
      ? `near-proof-${verificationId}-${timestamp}.json`
      : `near-proof-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [
    canExportProof,
    verificationId,
    model,
    requestHash,
    responseHash,
    effectiveRequestHash,
    effectiveResponseHash,
    localSignedText,
    verification,
    derivedStatus,
    verificationSections,
    remoteProof,
    signaturePayload,
    attestationSummary,
  ]);

  return {
    remoteProof,
    loading,
    fetchError,
    nrasData,
    nrasLoading,
    nrasError,
    retrying,
    verifyWithNRAS,
    attestationSummary,
    attestationPayload,
    nrasSummary,
    nvidiaPayloadForNras,
    expectationsReady,
    expectationInput,
    intelQuote,
    missingExpectations,
    canExportProof,
    hasInlineProof,
    hashMismatch,
    attestedHashes,
    verificationState,
    derivedStatus,
    verificationSections,
    effectiveRequestHash,
    effectiveResponseHash,
    localSignedText,
    retryFetch,
    exportProof,
    attestationNodes,
    signatureBinding,
    nrasVerified,
    nrasReasons,
  };
};
