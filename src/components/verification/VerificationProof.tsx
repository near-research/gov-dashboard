// components/verification/VerificationProof.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import type {
  VerificationMetadata,
  VerificationStatus,
} from "@/types/agui-events";
import type {
  VerificationProofResponse,
  NrasResult,
} from "@/types/verification";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  validateExpectations,
  isCompleteExpectations,
  type PartialExpectations,
} from "@/utils/attestation-expectations";
import { ethers } from "ethers";
import { deriveVerificationState } from "@/utils/attestation";
import { normalizeSignaturePayload } from "@/utils/verification";
import { extractHashesFromSignedText } from "@/utils/request-hash";
import { VerificationStatusPill } from "@/components/verification/VerificationStatusPill";
import { ProofStatusHeader } from "@/components/verification/ProofStatusHeader";
import { VerificationTimeline } from "@/components/verification/VerificationTimeline";
import { IndependentVerificationPanel } from "@/components/verification/IndependentVerificationPanel";
import { HardwareAttestationPanel } from "@/components/verification/HardwareAttestationPanel";
import { BasicInfoPanel } from "@/components/verification/BasicInfoPanel";
import { AlertsPanel } from "@/components/verification/AlertsPanel";
import { InlineProofPanel } from "@/components/verification/InlineProofPanel";
import { AttestationDetailsPanel } from "@/components/verification/AttestationDetailsPanel";
import { SignatureDetailsPanel } from "@/components/verification/SignatureDetailsPanel";
import { UnrecognizedFormatPanel } from "@/components/verification/UnrecognizedFormatPanel";
import { ExternalLink, Shield, Lock } from "lucide-react";
import { ModelAttestation } from "./ModelAttestation";

const formatUnknown = (value: unknown) => {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export type RemoteProof = VerificationProofResponse;

interface VerificationProofProps {
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
  className?: string;
  triggerLabel?: string;
  autoFetch?: boolean;
}

export function VerificationProof({
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
  className,
  triggerLabel = "View proof details",
  autoFetch = false,
}: VerificationProofProps) {
  const [open, setOpen] = useState(false);
  const [remoteProof, setRemoteProof] = useState<RemoteProof | null>(
    prefetchedProof
  );
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>(
    {}
  );
  const [nrasData, setNrasData] = useState<NrasResult | null>(null);
  const [nrasLoading, setNrasLoading] = useState(false);
  const [nrasError, setNrasError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [independentVerification, setIndependentVerification] = useState<{
    status: "idle" | "verifying" | "success" | "failed";
    checks?: {
      signature: boolean;
      hashes: boolean;
      nonce: boolean;
      address: boolean;
      nras: boolean;
    };
    details?: string;
  } | null>(null);

  const decodeJwt = useCallback((token?: string | null) => {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      const decoded = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }, []);

  const verifyNRASJWT = useCallback((jwt?: string | null) => {
    if (!jwt || typeof jwt !== "string") return false;
    try {
      const parts = jwt.split(".");
      if (parts.length !== 3) return false;

      const header = JSON.parse(
        atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"))
      );
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
      );

      if (!header || !payload) return false;
      if (payload.iss !== "https://nras.attestation.nvidia.com") return false;

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) return false;
      if (payload.nbf && payload.nbf > now) return false;
      if (payload["x-nvidia-overall-att-result"] !== true) return false;

      return true;
    } catch {
      return false;
    }
  }, []);

  // Enhanced verification state with step tracking

  const signaturePayload = useMemo(
    () => normalizeSignaturePayload(remoteProof?.signature),
    [remoteProof?.signature]
  );

  const attestedHashes = useMemo(
    () => extractHashesFromSignedText(signaturePayload?.text),
    [signaturePayload?.text]
  );

  const effectiveRequestHash = useMemo(() => {
    return (
      attestedHashes?.requestHash ||
      remoteProof?.requestHash ||
      requestHash ||
      null
    );
  }, [attestedHashes, remoteProof?.requestHash, requestHash]);

  const effectiveResponseHash = useMemo(() => {
    return (
      attestedHashes?.responseHash ||
      remoteProof?.responseHash ||
      responseHash ||
      null
    );
  }, [attestedHashes, remoteProof?.responseHash, responseHash]);

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
    if (
      !attestedHashes ||
      !recordedRequestHash ||
      !recordedResponseHash ||
      !attestedHashes.requestHash ||
      !attestedHashes.responseHash
    ) {
      return false;
    }

    const normalize = (value: string) => value.trim().toLowerCase();
    return (
      normalize(attestedHashes.requestHash) !== normalize(recordedRequestHash) ||
      normalize(attestedHashes.responseHash) !== normalize(recordedResponseHash)
    );
  }, [attestedHashes, recordedRequestHash, recordedResponseHash]);

  const attestationPayload = (() => {
    const att = remoteProof?.attestation;
    if (!att) return null;
    const gateway = att.gateway_attestation ?? att;
    return {
      modelAttestation:
        att.model_attestations && att.model_attestations[0]
          ? att.model_attestations[0]
          : null,
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
  })();

  const parseJsonPayload = useCallback((value: unknown) => {
    if (!value) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (typeof value === "object") {
      return value as Record<string, any>;
    }
    return null;
  }, []);

  const attestationSummary = useMemo(() => {
    const nras = remoteProof?.nras || nrasData;

    const decodeLocalJwt = (token?: string | null) => {
      if (!token || typeof token !== "string") return null;
      const parts = token.split(".");
      if (parts.length < 2) return null;
      try {
        const decoded = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
        return JSON.parse(decoded);
      } catch {
        return null;
      }
    };

    // Prefer decoded claims from server; otherwise decode first GPU token
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
      const nvidiaPayload =
        att.model_attestations?.[0]?.nvidia_payload ||
        att.nvidia_payload ||
        att.gateway_attestation?.nvidia_payload;
      const intelPayload =
        att.intel_quote ||
        att.gateway_attestation?.intel_quote ||
        att.model_attestations?.[0]?.intel_quote;

      const nvidia = parseJsonPayload(nvidiaPayload);
      const intel = parseJsonPayload(intelPayload);
      const claims = nrasClaims || {};

      const secbootRaw = nvidia?.secboot ?? nvidia?.["x-nvidia-secboot"];
      const dbgstatRaw = nvidia?.dbgstat ?? nvidia?.["x-nvidia-dbgstat"];
      // Only trust attestation result from NRAS-verified claims
      const attResult =
        (remoteProof?.nras || nrasData) && nrasClaims
          ? nrasClaims?.["x-nvidia-overall-att-result"] ??
            nrasClaims?.overall_result ??
            nrasClaims?.overall_pass
          : undefined;

      const hardwareFromVerifiedClaims = Boolean(
        remoteProof?.nras?.verified || nrasData?.verified
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

      const hardwareValidated =
        gpuValidated &&
        (intelQuotePresent && intelConfigured
          ? remoteProof?.intel?.verified === true
          : true);

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

      return {
        gpu: safeValue(
          claims?.hwmodel ||
            claims?.["x-nvidia-gpu-hwmodel"] ||
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
        nonce: hardwareFromVerifiedClaims
          ? claims?.eat_nonce ||
            claims?.["x-nvidia-eat-nonce"] ||
            nvidia?.eat_nonce ||
            intel?.eat_nonce ||
            ""
          : "",
        oem: safeValue(claims?.oemid || intel?.oemid || nvidia?.oemid),
        secboot: hardwareFromVerifiedClaims
          ? claims?.secboot === true || claims?.secboot === "enabled"
            ? "Enabled"
            : claims?.secboot === false || claims?.secboot === "disabled"
            ? "Disabled"
            : "Unverified"
          : "Unverified",
        dbgstat: safeValue(
          claims?.dbgstat || claims?.["x-nvidia-dbgstat"] || dbgstatRaw
        ),
        attestationResult:
          backendAttestationResult ||
          (attResult === false
            ? "Fail"
            : hardwareValidated
            ? "Pass"
            : "Unverified"),
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
            ? remoteProof?.nras?.reasons?.join?.("\n") ||
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
  }, [remoteProof, nrasData, parseJsonPayload]);

  const nrasSummary = (() => {
    const nras: NrasResult | null = remoteProof?.nras ?? nrasData;
    if (!nras) return null;

    return {
      verified: Boolean(nras.verified),
      jwt:
        typeof nras.token === "string"
          ? nras.token
          : typeof nras.jwt === "string"
          ? nras.jwt
          : null,
      claims: nras.claims,
      gpus: nras.gpus,
      raw: remoteProof?.nrasRaw ?? nras,
    };
  })();

  const nvidiaPayloadForNras = (() => {
    const att = attestationPayload?.modelAttestation || attestationPayload?.raw;
    if (!att) return null;

    const candidate =
      att?.nvidia_payload ||
      att?.model_attestations?.[0]?.nvidia_payload ||
      att?.gateway_attestation?.nvidia_payload ||
      null;

    if (!candidate) return null;

    let parsed = candidate;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }

    const payload = {
      nonce:
        parsed?.nonce ??
        parsed?.eat_nonce ??
        parsed?.["x-nvidia-eat-nonce"] ??
        null,
      arch: parsed?.arch ?? parsed?.gpu_arch ?? parsed?.["x-nvidia-arch"],
      evidence_list:
        parsed?.evidence_list ??
        parsed?.evidenceList ??
        parsed?.evidences ??
        null,
    };

    if (
      !payload.nonce ||
      !payload.arch ||
      !Array.isArray(payload.evidence_list)
    ) {
      return null;
    }

    return payload;
  })();

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

  const expectationsReady = expectationsValidation.complete;

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

  const missingExpectations = useMemo(
    () =>
      expectationsValidation.missing.map((key) => {
        switch (key) {
          case "arch":
            return "expected arch";
          case "deviceCertHash":
            return "expected device cert hash";
          case "rimHash":
            return "expected RIM hash";
          case "ueid":
            return "expected UEID";
          case "measurements":
            return "expected measurements";
          default:
            return key;
        }
      }),
    [expectationsValidation.missing]
  );

  const verifyWithNRAS = useCallback(async () => {
    if (!isCompleteExpectations(expectationInput)) {
      setNrasError(
        "Hardware expectations missing. NRAS verification requires nonce, arch, device cert hash, RIM hash, UEID, and measurements."
      );
      return;
    }

    if (!nvidiaPayloadForNras) {
      setNrasError("No NVIDIA payload available for NRAS verification");
      return;
    }

    try {
      setNrasLoading(true);
      setNrasError(null);

      const response = await fetch("/api/verification/nras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nvidia_payload: nvidiaPayloadForNras,
          nonce: expectationInput.nonce,
          expectedArch: expectationInput.arch,
          expectedDeviceCertHash: expectationInput.deviceCertHash,
          expectedRimHash: expectationInput.rimHash,
          expectedUeid: expectationInput.ueid,
          expectedMeasurements: expectationInput.measurements,
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        if (text.includes("Request Header Or Cookie Too Large")) {
          throw new Error(
            "NRAS payload too large. Manually POST the model-level payload to NRAS and decode the returned JWT."
          );
        }
        throw new Error(
          `NRAS verification failed (${response.status}): ${
            text || "Unknown error"
          }`
        );
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      if (!parsed?.verified) {
        throw new Error(
          parsed?.error ||
            "NRAS verification response missing verified flag; treating as unverified."
        );
      }

      const token: string | null = parsed?.jwt ?? null;
      const claims = parsed?.claims || (token ? decodeJwt(token) : null);
      const gpus = parsed?.gpus || null;

      setNrasData({
        token,
        claims,
        gpus,
        raw: parsed,
        verified: true,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "NRAS verification failed";
      setNrasError(message);
    } finally {
      setNrasLoading(false);
    }
  }, [nvidiaPayloadForNras, decodeJwt, expectationInput]);

  const verifyIndependently = useCallback(async () => {
    if (!remoteProof || !signaturePayload) {
      toast.error("No proof data available to verify");
      return;
    }

    const verificationToastId = "verification-result";

    setIndependentVerification({ status: "verifying" });

    try {
      let signatureValid = false;
      let recoveredAddr: string | null = null;
      try {
        recoveredAddr = ethers.verifyMessage(
          signaturePayload.text || "",
          signaturePayload.signature || ""
        );
        signatureValid = Boolean(recoveredAddr);
      } catch (error) {
        console.error("Signature verification failed:", error);
        signatureValid = false;
      }

      const hashesValid = Boolean(
        effectiveRequestHash &&
          effectiveResponseHash &&
          signaturePayload.text &&
          signaturePayload.text
            .toLowerCase()
            .includes(effectiveRequestHash.toLowerCase()) &&
          signaturePayload.text
            .toLowerCase()
            .includes(effectiveResponseHash.toLowerCase())
      );

      const nonceValid = Boolean(
        remoteProof.nonceCheck?.valid === true &&
          remoteProof.nonceCheck.expected === remoteProof.nonceCheck.attested &&
          (!remoteProof.nonceCheck.nras ||
            remoteProof.nonceCheck.nras === remoteProof.nonceCheck.expected)
      );

      let addressValid = false;
      if (recoveredAddr && attestationPayload) {
        const recoveredLower = recoveredAddr.toLowerCase();

        if (
          signaturePayload.signing_address?.toLowerCase() === recoveredLower
        ) {
          addressValid = true;
        }

        if (
          !addressValid &&
          attestationPayload.raw?.signing_address?.toLowerCase() ===
            recoveredLower
        ) {
          addressValid = true;
        }

        if (
          !addressValid &&
          Array.isArray(attestationPayload.raw?.model_attestations)
        ) {
          addressValid = attestationPayload.raw.model_attestations.some(
            (att: any) => att?.signing_address?.toLowerCase() === recoveredLower
          );
        }
      }

      const nrasJWT =
        remoteProof.nras?.token ||
        remoteProof.nras?.jwt ||
        nrasData?.token ||
        nrasData?.jwt;
      const nrasValid = verifyNRASJWT(nrasJWT);

      const allValid =
        signatureValid &&
        hashesValid &&
        nonceValid &&
        addressValid &&
        nrasValid;

      setIndependentVerification({
        status: allValid ? "success" : "failed",
        checks: {
          signature: signatureValid,
          hashes: hashesValid,
          nonce: nonceValid,
          address: addressValid,
          nras: nrasValid,
        },
        details: allValid
          ? "All cryptographic checks passed in your browser"
          : "Some checks failed - see details below",
      });

      console.info("[verification] browser checks", {
        signatureValid,
        hashesValid,
        nonceValid,
        addressValid,
        nrasValid,
        recoveredAddr,
        allValid,
      });

      if (allValid) {
        toast.success("Verification complete", {
          id: verificationToastId,
          description: "All checks passed.",
        });
      } else {
        toast.warning("Some checks failed", {
          id: verificationToastId,
          description: "See details below for which checks did not pass",
        });
      }
    } catch (error) {
      console.error("ERROR:", error);
      setIndependentVerification({
        status: "failed",
        details:
          error instanceof Error
            ? error.message
            : "Unknown error during verification",
      });
      toast.error("Verification error", {
        id: verificationToastId,
        description: "Failed to perform independent verification",
      });
    }
  }, [
    attestationPayload,
    remoteProof,
    effectiveRequestHash,
    effectiveResponseHash,
    signaturePayload,
    verifyNRASJWT,
    nrasData,
  ]);

  // Auto-verify proofs in background when loaded
  useEffect(() => {
    if (remoteProof && signaturePayload && !independentVerification) {
      verifyIndependently();
    }
  }, [
    remoteProof,
    signaturePayload,
    independentVerification,
    verifyIndependently,
  ]);

  useEffect(() => {
    setRemoteProof(prefetchedProof);
  }, [prefetchedProof]);

  useEffect(() => {
    if (prefetchedProof) {
      setFetchError(null);
      return;
    }
    setRemoteProof(null);
    setFetchError(null);
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
        setLoading(true);
        setFetchError(null);

        const response = await fetch("/api/verification/proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verificationId,
            model,
            requestHash,
            responseHash,
            nonce: expectationInput.nonce,
            expectedArch: expectationInput.arch,
            expectedDeviceCertHash: expectationInput.deviceCertHash,
            expectedRimHash: expectationInput.rimHash,
            expectedUeid: expectationInput.ueid,
            expectedMeasurements: expectationInput.measurements,
          }),
        });

        if (!response.ok) {
          // Enhanced error parsing
          const text = await response.text();
          let errorMessage = "Failed to fetch proof";

          try {
            const parsed = JSON.parse(text);
            errorMessage =
              parsed?.details ||
              parsed?.error ||
              parsed?.message ||
              errorMessage;

            // Add helpful context based on status code
            if (response.status === 404) {
              errorMessage +=
                "\n\nProof may have expired. Proofs are only available for 5 minutes after generation unless queried.";
            } else if (response.status === 401 || response.status === 403) {
              errorMessage +=
                "\n\nAuthentication error. Please check your API key.";
            }
          } catch {
            errorMessage = text || errorMessage;
          }

          throw new Error(errorMessage);
        }

        const data = await response.json();
        setRemoteProof({
          attestation: data.attestation ?? null,
          signature: data.signature ?? null,
          nras: data.nras ?? null,
          nrasRaw: data.nrasRaw ?? null,
          nonceCheck: data.nonceCheck ?? null,
          intel: data.intel ?? null,
          results: data.results ?? undefined,
          configMissing: data.configMissing ?? undefined,
        });
      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message || "Unable to fetch proof"
            : "Unable to fetch proof";
        setFetchError(errorMsg);
      } finally {
        setLoading(false);
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
  ]);

  const localSignedText = useMemo(() => {
    if (!effectiveRequestHash || !effectiveResponseHash) return null;
    return `${effectiveRequestHash}:${effectiveResponseHash}`;
  }, [effectiveRequestHash, effectiveResponseHash]);

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
      attestedAddress: null, // allow comprehensive TEE node matching
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
        icon: Shield,
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
        icon: Shield,
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
        icon: Lock,
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

  const retryFetch = () => {
    setRetrying(true);
    setFetchError(null);
    setRemoteProof(null);
    setTimeout(() => setRetrying(false), 300);
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

  if (!hasAnyData) return null;

  const renderCodeField = (label: string, value?: string, copyable = true) => {
    if (!value) return null;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {copyable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(value);
              }}
            >
              Copy
            </Button>
          )}
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed break-all overflow-hidden font-mono">
          {value}
        </div>
      </div>
    );
  };

  const renderDataField = (
    label: string,
    value?: unknown,
    collapsible = false
  ) => {
    if (!value) return null;

    const isExpanded =
      !collapsible || expandedFields[label] !== undefined
        ? expandedFields[label] ?? true
        : true;

    const toggle = () =>
      setExpandedFields((prev) => ({ ...prev, [label]: !isExpanded }));

    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {collapsible && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={toggle}
            >
              {isExpanded ? "Collapse" : "Expand"}
            </Button>
          )}
        </div>
        {isExpanded && (
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 max-h-[200px] overflow-auto">
            <pre className="text-[12px] whitespace-pre-wrap break-all leading-relaxed overflow-hidden font-mono">
              {typeof value === "string" ? value : formatUnknown(value)}
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderTimestamp = (label: string, value?: string | number) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return renderCodeField(label, date.toLocaleString(), false);
  };

  return (
    <>
      <VerificationStatusPill
        status={derivedStatus}
        className={className}
        onClick={() => setOpen(true)}
        label={triggerLabel}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl w-[95vw] sm:max-w-5xl sm:w-full max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="sr-only">Verification proof</DialogTitle>
            <DialogDescription className="sr-only">
              Detailed verification proof details and hardware attestation
              results.
            </DialogDescription>
            <ProofStatusHeader
              status={derivedStatus}
              verificationState={verificationState}
              configMissing={remoteProof?.configMissing}
              nrasError={nrasError}
              fetchError={fetchError}
              canExportProof={canExportProof}
              onExportProof={exportProof}
              onRetryFetch={retryFetch}
              retrying={retrying}
            />
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1">
            <div className="space-y-5 text-sm px-2 pb-2">
              {loading && (
                <div className="space-y-3">
                  <div className="h-4 bg-muted rounded animate-pulse" />
                  <div className="h-4 bg-muted rounded animate-pulse" />
                  <div className="h-4 bg-muted rounded animate-pulse" />
                </div>
              )}

              {remoteProof && (
                <VerificationTimeline verificationState={verificationState} />
              )}

              {/* {independentVerification?.checks && (
                <IndependentVerificationPanel
                  independentVerification={independentVerification}
                />
              )} */}

              {attestationSummary && (
                <HardwareAttestationPanel
                  attestationSummary={attestationSummary}
                  nrasSummary={nrasSummary}
                  nvidiaPayloadForNras={nvidiaPayloadForNras}
                  nrasError={nrasError}
                  nrasLoading={nrasLoading}
                  expectationsReady={expectationsReady}
                  intelQuote={intelQuote}
                  canExportProof={canExportProof}
                  onVerifyWithNRAS={verifyWithNRAS}
                  onExportProof={exportProof}
                  configMissing={remoteProof?.configMissing}
                  model={model}
                />
              )}

              {/* <BasicInfoPanel
                verificationId={verificationId}
                model={model}
                verification={verification}
                requestHash={requestHash}
                responseHash={responseHash}
                remoteProof={remoteProof}
                renderCodeField={renderCodeField}
                renderTimestamp={renderTimestamp}
              /> */}

              <AlertsPanel
                missingExpectations={missingExpectations}
                remoteProof={remoteProof}
                prefetchedProof={prefetchedProof}
                verificationId={verificationId}
                loading={loading}
                fetchError={fetchError}
                hashMismatch={hashMismatch}
                attestedRequestHash={attestedHashes?.requestHash}
                attestedResponseHash={attestedHashes?.responseHash}
                recordedRequestHash={
                  remoteProof?.sessionRequestHash ||
                  remoteProof?.requestHash ||
                  requestHash ||
                  null
                }
                recordedResponseHash={
                  remoteProof?.sessionResponseHash ||
                  remoteProof?.responseHash ||
                  responseHash ||
                  null
                }
              />

              {hasInlineProof && (
                <InlineProofPanel
                  verification={verification}
                  renderCodeField={renderCodeField}
                  renderDataField={renderDataField}
                />
              )}

              {verification?.attestationUrl && (
                <a
                  href={verification.attestationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline"
                >
                  View full attestation report
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {/* {attestationPayload && (
                <AttestationDetailsPanel
                  attestationPayload={attestationPayload}
                  renderCodeField={renderCodeField}
                />
              )} */}

              {/* {signaturePayload && (
                <SignatureDetailsPanel
                  signaturePayload={signaturePayload}
                  localSignedText={localSignedText}
                  renderCodeField={renderCodeField}
                />
              )} */}

              {remoteProof && !signaturePayload && !attestationPayload && (
                <UnrecognizedFormatPanel
                  remoteProof={remoteProof}
                  renderDataField={renderDataField}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
