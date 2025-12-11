import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateRequestHash,
  calculateResponseHash,
} from "@/verification/hashes-browser";
import type { VerificationProofResponse } from "@/types/verification";
import { deriveVerificationState } from "@/utils/attestation";
import { normalizeVerificationResult } from "@/utils/verification/shared";

type Params = {
  verificationId?: string | null;
  model?: string | null;
  requestBody?: any;
  responseBody?: string | null;
  prefetchedProof?: VerificationProofResponse | null;
};

type StepLoading = Record<"hash" | "signature" | "address" | "attestation" | "nonce" | "gpu" | "cpu", boolean>;

const initialStepLoading: StepLoading = {
  hash: false,
  signature: false,
  address: false,
  attestation: false,
  nonce: false,
  gpu: false,
  cpu: false,
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useVerification({
  verificationId,
  model,
  requestBody,
  responseBody,
  prefetchedProof = null,
}: Params) {
  const [proof, setProof] = useState<VerificationProofResponse | null>(prefetchedProof);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepLoading, setStepLoading] = useState<StepLoading>(initialStepLoading);
  const abortRef = useRef<AbortController | null>(null);

  const [requestHash, setRequestHash] = useState<string | null>(null);
  const [responseHash, setResponseHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      if (requestBody === undefined) {
        setRequestHash(null);
        return;
      }
      try {
        const hash = await calculateRequestHash(requestBody);
        if (!cancelled) setRequestHash(hash);
      } catch (err) {
        console.error("Request hash failed:", err);
        if (!cancelled) setRequestHash(null);
      }
    };
    void compute();
    return () => {
      cancelled = true;
    };
  }, [requestBody]);

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      if (responseBody === undefined || responseBody === null) {
        setResponseHash(null);
        return;
      }
      try {
        const hash = await calculateResponseHash(responseBody);
        if (!cancelled) setResponseHash(hash);
      } catch (err) {
        console.error("Response hash failed:", err);
        if (!cancelled) setResponseHash(null);
      }
    };
    void compute();
    return () => {
      cancelled = true;
    };
  }, [responseBody]);

  const normalizedProof = useMemo(() => {
    if (!proof) return null;
    return proof.normalized ?? normalizeVerificationResult(proof);
  }, [proof]);

  const verificationState = useMemo(() => {
    const attestation = proof?.attestation as any;
    const intelQuotePresent = (() => {
      if (!attestation) return false;
      if (attestation.intel_quote) return true;
      if (attestation.gateway_attestation?.intel_quote) return true;
      if (
        Array.isArray(attestation.model_attestations) &&
        attestation.model_attestations.some((node: any) => node?.intel_quote)
      )
        return true;
      if (
        Array.isArray(attestation.all_attestations) &&
        attestation.all_attestations.some((node: any) => node?.intel_quote)
      )
        return true;
      return false;
    })();

    return deriveVerificationState({
      proof,
      requestHash,
      responseHash,
      signatureText: (proof?.signature as any)?.text || null,
      signature: (proof?.signature as any)?.signature || null,
      signatureAddress: (proof?.signature as any)?.signing_address || null,
      attestedAddress:
        (proof?.attestation as any)?.gateway_attestation?.signing_address ||
        (proof?.attestation as any)?.signing_address ||
        null,
      attestationResult: proof?.results?.verified ? "Pass" : proof?.results ? "Fail" : null,
      nrasVerified: proof?.nras?.verified,
      nrasReasons: proof?.nras?.reasons,
      intelVerified: proof?.intel?.verified,
      normalizedVerification: normalizedProof,
      nonceCheck: proof?.nonceCheck ?? null,
      intelRequired: intelQuotePresent,
    });
  }, [proof, requestHash, responseHash, normalizedProof]);

  const exportProof = () => {
    if (!proof) return;
    const payload = {
      metadata: {
        exportedAt: new Date().toISOString(),
        verificationId: verificationId || null,
        model: model || null,
      },
      hashes: { request: requestHash, response: responseHash },
      proof,
      verificationState,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = verificationId ? `near-proof-${verificationId}-${ts}.json` : `near-proof-${ts}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    setProof(prefetchedProof);
  }, [prefetchedProof]);

  useEffect(() => {
    if (!verificationId || proof) return;
    if (!requestHash || !responseHash) return; // hashes needed for signature validation

    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    const run = async () => {
      setLoading(true);
      setError(null);
      setStepLoading({
        hash: true,
        signature: true,
        address: true,
        attestation: true,
        nonce: true,
        gpu: true,
        cpu: true,
      });

      const maxAttempts = 3;
      const backoffMs = 1000;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (cancelled) return;
        try {
          const res = await fetch("/api/verification/proof", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              verificationId,
              model,
              requestHash,
              responseHash,
            }),
            signal: controller.signal,
          });

          const text = await res.text();
          if (res.status === 404 && attempt < maxAttempts - 1) {
            await delay(backoffMs * (attempt + 1));
            continue;
          }
          if (!res.ok) {
            let message = text || "Failed to fetch proof";
            try {
              const parsed = JSON.parse(text);
              message = parsed?.details || parsed?.error || message;
            } catch {
              // keep text
            }
            throw new Error(message);
          }

          const parsedProof = text ? (JSON.parse(text) as VerificationProofResponse) : null;
          console.log("verification proof payload", {
            verificationId,
            requestHash,
            responseHash,
            proof: parsedProof,
          });
          const data = parsedProof;
          if (cancelled) return;
          if (data) {
            setProof(data);
          } else {
            setProof(null);
          }
          setError(null);
          break;
        } catch (err) {
          if (attempt >= maxAttempts - 1 || cancelled) {
            setError(err instanceof Error ? err.message : "Failed to fetch proof");
          }
        }
      }

      setLoading(false);
      setStepLoading(initialStepLoading);
    };

    run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [verificationId, model, requestHash, responseHash, proof]);

  return {
    loading,
    error,
    proof,
    verificationState,
    exportProof,
    stepLoading,
  };
}
