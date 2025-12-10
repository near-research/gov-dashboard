import type { RemoteProof } from "@/components/verification/VerificationProof";
import type { PartialExpectations } from "@/utils/attestation/expectations";

interface FetchVerificationProofParams {
  verificationId?: string;
  model?: string;
  requestHash?: string;
  responseHash?: string;
  expectationInput: PartialExpectations;
  signingAlgo?: string;
  authToken?: string;
}

export const fetchVerificationProof = async ({
  verificationId,
  model,
  requestHash,
  responseHash,
  expectationInput,
  signingAlgo,
  authToken,
}: FetchVerificationProofParams): Promise<RemoteProof> => {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch("/api/verification/proof", {
    method: "POST",
    credentials: "include",
    headers,
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
      signingAlgo,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = "Failed to fetch proof";

    try {
      const parsed = JSON.parse(text);
      errorMessage =
        parsed?.details || parsed?.error || parsed?.message || errorMessage;

      if (response.status === 404) {
        errorMessage +=
          "\n\nProof may have expired. Proofs are only available for 5 minutes after generation unless queried.";
      } else if (response.status === 401 || response.status === 403) {
        errorMessage += "\n\nAuthentication error. Please check your API key.";
      }
    } catch {
      errorMessage = text || errorMessage;
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  return {
    attestation: data.attestation ?? null,
    signature: data.signature ?? null,
    signatureError: data.signatureError ?? null,
    nras: data.nras ?? null,
    nrasRaw: data.nrasRaw ?? null,
    nonceCheck: data.nonceCheck ?? null,
    intel: data.intel ?? null,
    results: data.results ?? undefined,
    configMissing: data.configMissing ?? undefined,
  };
};

export interface VerifyNrasRequest {
  verificationId?: string;
  payload: any;
}

export const verifyWithNrasService = async ({
  verificationId,
  payload,
}: VerifyNrasRequest) => {
  const response = await fetch("/api/verification/nras", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verificationId,
      payload,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "Failed to verify with NVIDIA NRAS service");
  }

  return data;
};
