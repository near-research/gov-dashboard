import {
  SummaryRequestOptions,
  prepareSummaryRequest,
} from "@/lib/near-ai/summary";

export const signatureResponse = {
  text: "reqhash:reshash",
  signature:
    "0x77e4db99019046762da28e669d8fce369fca67361592efd7b90ce5b225d7d6450cc4e7ee5f5a6fff8c7ab892f1caabb3d5625ba61f0dd79f97a5344fbbfa468d1c",
  signing_address: "0x616AAa0c5FA690409Bf2c4F20Bf46d02AcD9BF69",
  signing_algo: "ecdsa",
};

const attestationNonce = "b".repeat(64);

export const attestationResponse = {
  request_nonce: attestationNonce,
  signing_address: signatureResponse.signing_address,
  nvidia_payload: JSON.stringify({
    eat_nonce: attestationNonce,
    arch: "HOPPER",
    evidence_list: [],
  }),
  intel_quote: JSON.stringify({ eat_nonce: attestationNonce }),
  model_attestations: [
    {
      request_nonce: attestationNonce,
      nvidia_payload: JSON.stringify({
        eat_nonce: attestationNonce,
        arch: "HOPPER",
        evidence_list: [],
      }),
      intel_quote: JSON.stringify({ eat_nonce: attestationNonce }),
    },
  ],
};

export const nrasSuccessArray = [
  ["JWT", "header.payload.sig"],
  {
    "GPU-0": "gpu-token",
  },
];

export const nrasError = {
  error: "NRAS attestation failed: 400",
  details: "Request Header Or Cookie Too Large",
};

export const proofPayload = {
  attestation: attestationResponse,
  signature: signatureResponse,
  nras: {
    verified: true,
    claims: {
      "x-nvidia-overall-att-result": true,
      "x-nvidia-gpu-driver-version": "570.123",
      "x-nvidia-gpu-vbios-version": "96.00",
      "x-nvidia-eat-nonce": attestationNonce,
      hwmodel: "GH100",
    },
    reasons: [],
  },
  nonceCheck: {
    expected: attestationNonce,
    attested: attestationNonce,
    nras: attestationNonce,
    valid: true,
  },
  intel: {
    verified: true,
    raw: { nonce: attestationNonce },
  },
  signatureVerification: {
    verified: true,
    recoveredAddress: signatureResponse.signing_address,
    attestedAddress: [signatureResponse.signing_address],
  },
  normalized: {
    verified: true,
    nrasVerified: true,
    signatureVerified: true,
    hardwareVerified: true,
    claims: {
      secboot: true,
      measres: "success",
      nonce: attestationNonce,
      overallResult: true,
    },
    reasons: [],
  },
  results: {
    verified: true,
    reasons: [],
  },
};

export const buildMockSummaryRequest = (options: SummaryRequestOptions) => {
  const { serialized, hash } = prepareSummaryRequest(options);
  return {
    requestBody: serialized,
    requestHash: hash,
  };
};

// Re-export shared verification mocks used across tests
export {
  verifiedProofMock,
  failedProofMock,
  mockNonce,
  mockAddress,
} from "./verificationMocks";
