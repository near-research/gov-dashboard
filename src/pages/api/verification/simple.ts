import type { NextApiRequest, NextApiResponse } from "next";
import { NEAR_AI_MODELS } from "@/utils/model-utils";
import {
  extractSigningAddresses,
  fetchAttestation,
  verifyChat,
  type VerificationResult,
} from "@/lib/verification";

type VerificationRequestBody = {
  prompt?: string;
  model?: string;
  signingAlgo?: "ecdsa" | "ed25519";
  temperature?: number;
  maxTokens?: number;
};

const DEFAULT_PROMPT = "In a few sentences, tell me something I don't know.";
const DEFAULT_MODEL = NEAR_AI_MODELS.DEEPSEEK_V3_1;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 300;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    | {
        success: true;
        requestBody: string;
        nearRequest: unknown;
        verification: VerificationResult;
        diagnostics: {
          attestationAddresses: string[];
          attestationSummary: {
            modelAttestationsCount: number;
            hasGatewayAttestation: boolean;
            gatewayHasIntelQuote: boolean;
          };
          recoveredAddress: string | null;
          signatureClaimedAddress: string | null;
          recoveredMatchesClaimed: boolean;
          recoveredInAttestation: boolean;
          claimedInAttestation: boolean;
          addressFormat: {
            recoveredLower: string | null;
            recoveredWithout0x: string | null;
          };
        };
      }
    | { success: false; error: string }
  >
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const {
    prompt = DEFAULT_PROMPT,
    model = DEFAULT_MODEL,
    signingAlgo = "ecdsa",
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
  } = (req.body ?? {}) as VerificationRequestBody;

  const nearRequest = {
    model,
    messages: [
      { role: "system", content: "You are a precise, concise assistant." },
      { role: "user", content: prompt },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  const requestBody = JSON.stringify(nearRequest);
  const apiKey = process.env.NEAR_AI_CLOUD_API_KEY;

  if (!apiKey) {
    return res
      .status(500)
      .json({ success: false, error: "Missing NEAR_AI_CLOUD_API_KEY" });
  }

  try {
    const attestation = await fetchAttestation(model, apiKey);
    const teeAddresses = extractSigningAddresses(attestation);

    if (teeAddresses.length === 0) {
      return res.status(500).json({
        success: false,
        error: "No TEE signing addresses found for this model",
      });
    }

    const attestationSummary = {
      modelAttestationsCount: attestation.model_attestations?.length ?? 0,
      hasGatewayAttestation: Boolean(attestation.gateway_attestation),
      gatewayHasIntelQuote: Boolean(attestation.gateway_attestation?.intel_quote),
    };

    console.log(
      "[DIAG] Attestation report:",
      JSON.stringify(
        {
          modelAttestationsCount: attestationSummary.modelAttestationsCount,
          modelAttestations: attestation.model_attestations?.map((node, index) => ({
            index,
            signing_address: node?.signing_address,
            hasNvidiaPayload: Boolean(node?.nvidia_payload),
            hasIntelQuote: Boolean(node?.intel_quote),
          })),
          gatewayAttestation: attestation.gateway_attestation
            ? {
                signing_address: attestation.gateway_attestation.signing_address,
                hasIntelQuote: Boolean(attestation.gateway_attestation.intel_quote),
              }
            : null,
        },
        null,
        2
      )
    );
    console.log("[DIAG] Extracted TEE addresses:", teeAddresses);

    const verification = await verifyChat({
      requestBody,
      model,
      apiKey,
      signingAlgo,
    });

    const recoveredAddress = verification.signatureValidation?.recoveredAddress ??
      null;
    const signatureClaimedAddress = verification.signature?.signing_address ?? null;

    const normalizedTeeAddresses = teeAddresses.map((addr) =>
      addr.toLowerCase()
    );

    const recoveredMatchesClaimed =
      typeof recoveredAddress === "string" &&
      typeof signatureClaimedAddress === "string" &&
      recoveredAddress.toLowerCase() === signatureClaimedAddress.toLowerCase();

    const recoveredInAttestation = Boolean(
      recoveredAddress &&
        normalizedTeeAddresses.includes(recoveredAddress.toLowerCase())
    );
    const claimedInAttestation = Boolean(
      signatureClaimedAddress &&
        normalizedTeeAddresses.includes(signatureClaimedAddress.toLowerCase())
    );

    const recoveredLower = recoveredAddress?.toLowerCase() ?? null;
    const recoveredWithout0x = recoveredLower?.replace(/^0x/, "") ?? null;

    console.log("[DIAG] Signature response:", JSON.stringify({
      text: verification.signature?.text,
      signing_address: signatureClaimedAddress,
      signing_algo: verification.signature?.signing_algo,
    }, null, 2));

    console.log(
      "[DIAG] Address comparison:",
      JSON.stringify(
        {
          recoveredAddress,
          signatureClaimedAddress,
          recoveredMatchesClaimed,
          attestationAddresses: teeAddresses,
          recoveredInAttestation,
          claimedInAttestation,
        },
        null,
        2
      )
    );

    console.log(
      "[DIAG] Address format check:",
      JSON.stringify(
        {
          recoveredLower,
          recoveredWithout0x,
          anyPartialMatch: normalizedTeeAddresses.some((addr) =>
            addr.includes(recoveredWithout0x ?? "nomatch")
          ),
        },
        null,
        2
      )
    );

    return res.status(200).json({
      success: true,
      nearRequest,
      requestBody,
      verification,
      diagnostics: {
        attestationAddresses: teeAddresses,
        attestationSummary,
        recoveredAddress,
        signatureClaimedAddress,
        recoveredMatchesClaimed,
        recoveredInAttestation,
        claimedInAttestation,
        addressFormat: {
          recoveredLower,
          recoveredWithout0x,
        },
      },
    });
  } catch (error) {
    console.error("[verification/simple] error", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    });
  }
}
