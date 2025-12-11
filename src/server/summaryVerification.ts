import { randomUUID } from "crypto";
import type { NearAIClient } from "@/lib/near-ai/client";
import { sha256 } from "@/lib/verification";
import { getModelExpectations } from "@/server/attestation-cache";
import { mergeVerificationStatusFromProof } from "@/server/verificationUtils";
import { prefetchVerificationProof } from "@/server/prefetchVerificationProof";
import type { SummaryProof } from "@/types/summaries";
import type {
  AttestationExpectations,
  VerificationMetadata,
  VerificationProofResponse,
  VerificationResult,
} from "@/types/verification";

export interface SummaryVerificationContext {
  client: NearAIClient;
  origin?: string | null;
  model: string;
  verificationId: string;
  sessionNonce: string;
  requestBody: string;
  responseText: string;
  chatId: string | null;
}

export interface SummaryVerificationData {
  verificationResult: VerificationResult;
  verificationMetadata: VerificationMetadata;
  proof: SummaryProof;
  remoteProof?: VerificationProofResponse | null;
  requestHash: string;
  responseHash: string;
}

export const createSummaryVerificationId = () => `summary-${randomUUID()}`;

export const buildFailedVerificationResult = (
  message: string
): VerificationResult => ({
  verified: false,
  status: "failed",
  chatId: null,
  requestHash: "",
  responseHash: "",
  signature: null,
  warnings: [message],
  reasons: [],
});

export async function finalizeSummaryVerification(
  context: SummaryVerificationContext
): Promise<SummaryVerificationData> {
  const {
    client,
    origin,
    model,
    verificationId,
    sessionNonce,
    requestBody,
    responseText,
    chatId,
  } = context;

  const requestHash = sha256(requestBody);
  const responseHash = sha256(responseText);

  client.updateSessionHashes(verificationId, {
    requestHash,
    responseHash,
  });

  const verificationResult =
    chatId != null
      ? await client.verifyChatPayload({
          requestBody,
          responseText,
          chatId,
          model,
        })
      : buildFailedVerificationResult(
          "Missing chat ID from NEAR AI response"
        );

  let expectations: AttestationExpectations | null = null;
  try {
    expectations = await getModelExpectations(model);
  } catch (error) {
    console.warn(
      `[summaryVerification] Failed to load expected measurements for ${model}:`,
      error
    );
  }

  const proof: SummaryProof = {
    requestHash,
    responseHash,
    nonce: sessionNonce,
    arch: expectations?.arch,
    deviceCertHash: expectations?.deviceCertHash,
    rimHash: expectations?.rimHash,
    ueid: expectations?.ueid,
    measurements: expectations?.measurements,
  };

  let verificationMetadata: VerificationMetadata = {
    source: "near-ai-cloud",
    status: "pending",
    messageId: chatId ?? verificationId,
    nonce: sessionNonce,
  };

  let remoteProof: VerificationProofResponse | null = null;
  try {
    remoteProof = await prefetchVerificationProof(origin ?? undefined, {
      verificationId,
      model,
      requestHash,
      responseHash,
      nonce: sessionNonce,
      expectedArch: expectations?.arch ?? undefined,
      expectedDeviceCertHash: expectations?.deviceCertHash ?? undefined,
      expectedRimHash: expectations?.rimHash ?? undefined,
      expectedUeid: expectations?.ueid ?? undefined,
      expectedMeasurements: expectations?.measurements ?? undefined,
    });
    const mergedMetadata = mergeVerificationStatusFromProof(
      verificationMetadata,
      remoteProof ?? undefined
    );
    if (mergedMetadata) {
      verificationMetadata = mergedMetadata;
    }
  } catch (error) {
    console.warn("[summaryVerification] Prefetch proof failed:", error);
    remoteProof = null;
  }

  return {
    verificationResult,
    verificationMetadata,
    proof,
    remoteProof,
    requestHash,
    responseHash,
  };
}
