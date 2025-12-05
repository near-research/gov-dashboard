#!/usr/bin/env bun

const NEAR_API_BASE = "https://cloud-api.near.ai/v1";
const API_KEY = process.env.NEAR_AI_CLOUD_API_KEY;
const MESSAGE_ID = process.env.VERIFICATION_HEALTH_MESSAGE_ID;
const MODEL = process.env.VERIFICATION_HEALTH_MODEL || "gpt-oss-120b";
const SIGNING_ALGO = process.env.VERIFICATION_HEALTH_SIGNING_ALGO || "ecdsa";

if (!API_KEY) {
  console.error("[verification-health] NEAR_AI_CLOUD_API_KEY is required");
  process.exit(1);
}

if (!MESSAGE_ID) {
  console.error("[verification-health] VERIFICATION_HEALTH_MESSAGE_ID is required");
  process.exit(1);
}

const signatureUrl = `${NEAR_API_BASE}/signature/${encodeURIComponent(
  MESSAGE_ID
 )}?model=${encodeURIComponent(MODEL)}&signing_algo=${encodeURIComponent(
  SIGNING_ALGO
 )}`;

async function main() {
  console.log("[verification-health] probing signature fetch", { signatureUrl });

  const response = await fetch(signatureUrl, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error(
      `[verification-health] Signature fetch failed (${response.status} ${response.statusText})`
    );
    process.exit(1);
  }

  console.log(
    `[verification-health] Signature fetch succeeded (${response.status})`
  );
}

main().catch((error) => {
  console.error("[verification-health] Unexpected error", error);
  process.exit(1);
});
