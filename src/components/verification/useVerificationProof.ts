import { useCallback, useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import { validateExpectations } from "@/utils/attestation/expectations";
import { verifyMessage } from "ethers";
import { deriveVerificationState } from "@/utils/attestation/state";
import {
  buildAttestationPayload,
  buildAttestationSummary,
  buildAttestedHashes,
  buildSignaturePayload,
  resolveEffectiveHash,
  resolveNvidiaPayloadForNras,
  buildNrasSummary,
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
  VerificationProofResponse,
} from "@/types/verification";
import { normalizeHashValue } from "@/utils/verification/shared";
import { createVerificationAuthToken } from "@/utils/verification/auth";
import { useNear } from "@/hooks/useNear";
import { siwnRecipient } from "@/config/siwn";
import { sign } from "near-sign-verify";

export type RemoteProof = VerificationProofResponse;

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
  independentVerification: {
    status: "idle" | "verifying" | "success" | "failed";
    checks?: {
      signature: boolean;
      hashes: boolean;
      nonce: boolean;
      address: boolean;
      nras: boolean;
    };
    details?: string;
  } | null;
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
  | { type: "SET_RETRYING"; value: boolean }
  | {
      type: "SET_INDEPENDENT";
      verification: VerificationProofState["independentVerification"];
    };

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
  independentVerification: null,
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
    case "SET_INDEPENDENT":
      return { ...state, independentVerification: action.verification };
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
    independentVerification,
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

  const attestationSummary = useMemo(
    () => buildAttestationSummary({ remoteProof, nrasData }),
    [remoteProof, nrasData]
  );

  const nrasSummary = useMemo(
    () => buildNrasSummary(remoteProof, nrasData),
    [remoteProof, nrasData]
  );

  const nvidiaPayloadForNras = useMemo(
    () => resolveNvidiaPayloadForNras(attestationPayload),
    [attestationPayload]
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

  const intelQuote = useMemo(() => {
    const att = remoteProof?.attestation;
    if (!att) return null;

    return (
      att.gateway_attestation?.intel_quote ||
      att.intel_quote ||
      att.model_attestations?.[0]?.intel_quote ||
      null
    );
  }, [remoteProof]);

  const missingExpectations = useMemo(() => {
    const missing: string[] = [];
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
  }, [expectationsValidation, expectationInput]);

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

  const verifyIndependently = useCallback(async () => {
    if (!signaturePayload || !effectiveRequestHash || !effectiveResponseHash) {
      return;
    }
    dispatch({
      type: "SET_INDEPENDENT",
      verification: {
        status: "verifying",
        checks: {
          signature: false,
          hashes: false,
          nonce: false,
          address: false,
          nras: false,
        },
      },
    });

    const checks = {
      signature: false,
      hashes: false,
      nonce: false,
      address: false,
      nras: false,
    };

    const setResult = (partial: Partial<typeof checks>) =>
      dispatch({
        type: "SET_INDEPENDENT",
        verification: {
          status: "verifying",
          checks: { ...checks, ...partial },
        },
      });

    try {
      if (signaturePayload.signature && localSignedText) {
        const recovered = verifyMessage(
          localSignedText,
          signaturePayload.signature
        );
        checks.signature = true;
        checks.address =
          recovered?.toLowerCase() ===
          signaturePayload.signing_address?.toLowerCase();
        setResult({ signature: checks.signature, address: checks.address });
      } else {
        checks.signature = false;
        setResult({ signature: checks.signature });
      }
    } catch {
      checks.signature = false;
      checks.address = false;
      setResult({ signature: false, address: false });
    }

    checks.hashes =
      !!effectiveRequestHash &&
      !!effectiveResponseHash &&
      effectiveRequestHash.length === 64 &&
      effectiveResponseHash.length === 64;
    setResult({ hashes: checks.hashes });

    checks.nonce = !!remoteProof?.nonceCheck?.valid;
    setResult({ nonce: checks.nonce });

    checks.nras = !!remoteProof?.nras?.verified || !!nrasData?.verified;
    setResult({ nras: checks.nras });

    const success = Object.values(checks).every(Boolean);

    dispatch({
      type: "SET_INDEPENDENT",
      verification: {
        status: success ? "success" : "failed",
        checks,
        details: success
          ? "All local checks passed"
          : "Some checks failed. See details above.",
      },
    });
  }, [
    signaturePayload,
    effectiveRequestHash,
    effectiveResponseHash,
    remoteProof?.nonceCheck?.valid,
    nrasData?.verified,
    remoteProof?.nras?.verified,
    localSignedText,
  ]);

  useEffect(() => {
    if (remoteProof && signaturePayload && !independentVerification) {
      verifyIndependently();
    }
  }, [remoteProof, signaturePayload, independentVerification, verifyIndependently]);

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

    const nrasVerified = remoteProof?.nras?.verified || nrasData?.verified;
    const nrasReasons = remoteProof?.nras?.reasons || nrasData?.reasons;

    return deriveVerificationState({
      proof: remoteProof,
      requestHash: effectiveRequestHash,
      responseHash: effectiveResponseHash,
      signatureText: signaturePayload?.text || null,
      signature: signaturePayload?.signature || null,
      signatureAddress: signaturePayload?.signing_address || null,
      attestedAddress: null,
      attestationResult: attestationSummary?.attestationResult || null,
      nrasVerified: nrasVerified ?? undefined,
      nrasReasons: nrasReasons ?? undefined,
      intelVerified: remoteProof?.intel?.verified,
      nonceCheck: remoteProof?.nonceCheck ?? null,
      intelRequired,
      intelConfigured,
    });
  }, [
    remoteProof,
    nrasData,
    effectiveRequestHash,
    effectiveResponseHash,
    signaturePayload?.text,
    signaturePayload?.signature,
    signaturePayload?.signing_address,
    attestationPayload?.raw?.intel_quote,
    attestationPayload?.raw?.gateway_attestation?.intel_quote,
    attestationPayload?.modelAttestation?.intel_quote,
    attestationSummary?.attestationResult,
  ]);

  const derivedStatus: VerificationStatus = useMemo(() => {
    if (!remoteProof && !verification) return "pending";
    if (loading || independentVerification?.status === "verifying")
      return "pending";

    if (verification?.status && verification.status !== "pending") {
      return verification.status;
    }

    if (verificationState.overall === "verified") return "verified";
    if (verificationState.overall === "failed") return "failed";

    return verification?.status ?? "pending";
  }, [
    loading,
    independentVerification?.status,
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
    independentVerification,
    verifyIndependently,
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
  };
};
