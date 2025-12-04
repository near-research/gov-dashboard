const parseNumberFromEnv = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_SIGNING_ALGO = "ecdsa";
const DEFAULT_NEAR_API_BASE = "https://cloud-api.near.ai/v1";
const DEFAULT_NEAR_TIMEOUT_MS = 10_000;
const DEFAULT_FETCH_ATTEMPTS = 3;
const DEFAULT_FETCH_BASE_DELAY_MS = 500;

const DEFAULT_NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";
const DEFAULT_NRAS_JWKS_URL =
  "https://nras.attestation.nvidia.com/.well-known/jwks.json";
const DEFAULT_NRAS_AUDIENCE = "nvidia-attestation";
const DEFAULT_NRAS_TIMEOUT_MS = 10_000;
const DEFAULT_NRAS_JWKS_TTL_MS = 5 * 60 * 1000;

export const verificationConfig = {
  defaultModel: process.env.VERIFICATION_DEFAULT_MODEL || DEFAULT_MODEL,
  defaultSigningAlgo:
    process.env.VERIFICATION_DEFAULT_SIGNING_ALGO || DEFAULT_SIGNING_ALGO,
  nearApiBase: process.env.VERIFICATION_NEAR_API_BASE || DEFAULT_NEAR_API_BASE,
  nearRequestTimeoutMs: parseNumberFromEnv(
    "VERIFICATION_NEAR_TIMEOUT_MS",
    DEFAULT_NEAR_TIMEOUT_MS
  ),
  fetchBackoff: {
    attempts: parseNumberFromEnv(
      "VERIFICATION_FETCH_ATTEMPTS",
      DEFAULT_FETCH_ATTEMPTS
    ),
    baseDelayMs: parseNumberFromEnv(
      "VERIFICATION_FETCH_BASE_DELAY_MS",
      DEFAULT_FETCH_BASE_DELAY_MS
    ),
  },
  nras: {
    url: process.env.NRAS_URL || DEFAULT_NRAS_URL,
    jwksUrl: process.env.NRAS_JWKS_URL || DEFAULT_NRAS_JWKS_URL,
    audience: process.env.NRAS_AUDIENCE || DEFAULT_NRAS_AUDIENCE,
    timeoutMs: parseNumberFromEnv("NRAS_TIMEOUT_MS", DEFAULT_NRAS_TIMEOUT_MS),
    jwksTtlMs: parseNumberFromEnv(
      "NRAS_JWKS_TTL_MS",
      DEFAULT_NRAS_JWKS_TTL_MS
    ),
    mock: {
      driverVersion: process.env.NRAS_MOCK_DRIVER_VERSION || "570.123",
      vbiosVersion: process.env.NRAS_MOCK_VBIOS_VERSION || "96.00",
      hwModel: process.env.NRAS_MOCK_HW_MODEL || "GH100 A01 GSP BROM",
    },
  },
};
