import type { VerificationProofResponse } from "@/types/verification";
import { verificationConfig } from "@/config/verification";

export const mockNonce = "a".repeat(64);
export const mockAddress = "0x616AAa0c5FA690409Bf2c4F20Bf46d02AcD9BF69";
export const mockSignature =
  "0x77e4db99019046762da28e669d8fce369fca67361592efd7b90ce5b225d7d6450cc4e7ee5f5a6fff8c7ab892f1caabb3d5625ba61f0dd79f97a5344fbbfa468d1c";
export const mockSignedText = "req:res";

const NRAS_AUDIENCE = verificationConfig.nras.audience;

const toBase64Url = (value: any) =>
  Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value)
  ).toString("base64url");

const buildMockJwt = (
  payload: Record<string, any>,
  header: Record<string, any> = {}
) => {
  const jwtHeader = { alg: "ES256", kid: "mock-kid", ...header };
  const encodedHeader = toBase64Url(jwtHeader);
  const encodedPayload = toBase64Url(payload);
  const encodedSignature = toBase64Url("signature");
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
};

const buildBaseNrasClaims = (overrides: Record<string, any> = {}) => ({
  aud: NRAS_AUDIENCE,
  nonce: mockNonce,
  eat_nonce: mockNonce,
  "x-nvidia-eat-nonce": mockNonce,
  "x-nvidia-overall-att-result": true,
  "x-nvidia-gpu-driver-version": "570.123",
  "x-nvidia-gpu-vbios-version": "96.00",
  hwmodel: "GH100 A01 GSP BROM",
  secboot: "enabled",
  measres: "success",
  "x-nvidia-measres": "success",
  "x-nvidia-gpu-attestation-report-signature-verified": true,
  "x-nvidia-gpu-attestation-report-nonce-match": true,
  ...overrides,
});

export const verifiedProofMock: VerificationProofResponse = {
  attestation: {
    request_nonce: mockNonce,
    gateway_attestation: {
      request_nonce: mockNonce,
      signing_address: mockAddress,
      signing_algo: "ecdsa",
      nvidia_payload: {
        eat_nonce: mockNonce,
        arch: "HOPPER",
        evidence_list: [],
      },
    },
  },
  signature: {
    text: mockSignedText,
    signature: mockSignature,
    signing_address: mockAddress,
    signing_algo: "ecdsa",
  },
  nras: {
    verified: true,
    jwt: buildMockJwt(buildBaseNrasClaims()),
    claims: buildBaseNrasClaims(),
    gpus: {
      "GPU-0": buildMockJwt(
        buildBaseNrasClaims({
          "x-nvidia-gpu-attestation-report-signature-verified": true,
          "x-nvidia-gpu-attestation-report-nonce-match": true,
          measres: "success",
          "x-nvidia-measres": "success",
        }),
        { kid: "gpu-kid" }
      ),
    },
    raw: {},
    reasons: [],
  },
  nonceCheck: {
    expected: mockNonce,
    attested: mockNonce,
    nras: mockNonce,
    valid: true,
  },
  intel: {
    verified: true,
    raw: { nonce: mockNonce },
  },
};

export const failedProofMock: VerificationProofResponse = {
  attestation: { gateway_attestation: { signing_address: mockAddress } },
  signature: {
    text: "bad:req:res",
    signature: "0x0",
    signing_address: "0xdead",
    signing_algo: "ecdsa",
  },
  nras: {
    verified: false,
    jwt: "mock",
    claims: { "x-nvidia-overall-att-result": false },
    gpus: null,
    raw: {},
    reasons: ["NRAS failed"],
  },
  nonceCheck: {
    expected: mockNonce,
    attested: "wrong",
    nras: "wrong",
    valid: false,
  },
  intel: {
    verified: false,
    reasons: ["Intel verifier did not return success"],
  },
};

export const officialNearAIExample = {
  requestBody:
    '{"messages":[{"content":"Respond with only two words.","role":"user"}],"stream":true,"model":"deepseek-v3.1"}',
  requestHash: "2ec65b4a042f68d7d4520e21a7135505a5154d52aa87dbd19e9d08021ffe5c4d",
  responseHash: "bdcfaa70301ea760ad215a2de31e80b7a69ee920c02a4b97ae05d0798b75fe79",
  signature:
    "0xb6bed282118266c5bc157bc7a88185dd017826da13c7aeb2aeebb9be88c7c7400047b88528d29f82792df1f2288a1b84e11ffddfe32517d46d5f7056e9082b941c",
  signingAddress: "0xCaAA4842758658A85785Ad15367a700C601ffEA5",
  text: "2ec65b4a042f68d7d4520e21a7135505a5154d52aa87dbd19e9d08021ffe5c4d:bdcfaa70301ea760ad215a2de31e80b7a69ee920c02a4b97ae05d0798b75fe79",
};

export const officialNearAIExampleAlt = {
  text: "65b0adb47d0450971803dfb18d0ce4af4a64d27420a43d5aad4066ebf10b81b5:e508d818744d175a62aae1a9fb3f373c075460cbe50bf962a88ac008c843dff1",
  signature:
    "0xf28f537325c337fd96ae6e156783c904ca708dcd38fb8a476d1280dfc72dc88e4fcb5c3941bdd4f8fe5238a2253b975c6b02ea6a0a450b5b0f9296ab54cf24181b",
  signingAddress: "0xc51268C9b46140619CBC066A34441a6ca51F85f9",
};

export const partialProofMock: VerificationProofResponse = {
  attestation: { gateway_attestation: { signing_address: "0x123" } },
  signature: null,
  nras: null,
  nonceCheck: null,
  intel: null,
};

export const invalidSignatureMock: VerificationProofResponse = {
  ...verifiedProofMock,
  signature: {
    text: verifiedProofMock.signature!.text,
    signature:
      "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    signing_address: verifiedProofMock.signature!.signing_address,
    signing_algo: "ecdsa",
  },
};

export const nonceReplayAttackMock: VerificationProofResponse = {
  ...verifiedProofMock,
  nonceCheck: {
    expected: mockNonce,
    attested: "differentnonce123",
    nras: "differentnonce123",
    valid: false,
  },
};

export const expiredJwtMock = {
  jwt: "eyJhbGciOiJFUzM4NCIsImtpZCI6ImtpZDEifQ.eyJleHAiOjE2MDAwMDAwMDAsIm5iZiI6MTYwMDAwMDAwMCwiYXVkIjoibnZpZGlhLWF0dGVzdGF0aW9uIiwiZWF0X25vbmNlIjoibW9ja25vbmNlIn0.c2lnbmF0dXJl",
  claims: {
    exp: 1600000000,
    nbf: 1600000000,
    aud: "nvidia-attestation",
    eat_nonce: "mocknonce",
  },
};

export const intelRequiredProofMock: VerificationProofResponse = {
  ...verifiedProofMock,
  attestation: {
    ...verifiedProofMock.attestation,
    intel_quote: "base64encodedquote...",
  },
  intel: { verified: true, raw: { nonce: mockNonce } },
};

export const multiGpuProofMock: VerificationProofResponse = {
  ...verifiedProofMock,
  attestation: {
    ...verifiedProofMock.attestation,
    model_attestations: [
      {
        request_nonce: mockNonce,
        signing_address: "0xGPU1",
        nvidia_payload: JSON.stringify({ eat_nonce: "wrong-nonce" }),
      },
      {
        request_nonce: mockNonce,
        signing_address: "0xGPU2",
        nvidia_payload: JSON.stringify({ eat_nonce: mockNonce }),
      },
    ],
  },
};

export const configErrorMocks = {
  nearApiKeyMissing: { configMissing: { nearApiKey: true } },
  intelMissing: { configMissing: { intel: true } },
  intelApiKeyMissing: { configMissing: { intelApiKey: true } },
};

export const nvidiaJwtExample = {
  platform: {
    sub: "NVIDIA-PLATFORM-ATTESTATION",
    "x-nvidia-ver": "2.0",
    iss: "https://nras.attestation.nvidia.com",
    "x-nvidia-overall-att-result": true,
    eat_nonce: "4d6e0c49321d22daa9bd7fc2205e381f9506c20e77dd5082ecf5e124ec0f4618",
    submods: {
      "GPU-0": ["DIGEST", ["SHA-256", "02fc2f1873bdf89cee4f3e43c57e17c248518702d8dfc3706a7b7fe8036e93d0"]],
    },
  },
  gpu: {
    iss: "https://nras.attestation.nvidia.com",
    hwmodel: "GH100 A01 GSP BROM",
    ueid: "642960189298007511250958030500749152730221142468",
    secboot: true,
    dbgstat: "disabled",
    "x-nvidia-gpu-driver-version": "570.133.20",
    "x-nvidia-gpu-vbios-version": "96.00.CF.00.02",
    eat_nonce: "4d6e0c49321d22daa9bd7fc2205e381f9506c20e77dd5082ecf5e124ec0f4618",
  },
};
