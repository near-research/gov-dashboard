import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";
import { sha256sum, verifyChatMessage } from "@/lib/near-ai";
import type { SummaryProof } from "@/components/proposal/types/summaries";
import type { VerificationMetadata, VerificationResult } from "@/lib/near-ai";

export interface SummaryVerificationContext {
  origin?: string | null;
  model: string;
  verificationId: string;
  requestBody: string;
  responseText: string;
  chatId: string | null;
  requestHash?: string;
}

export interface SummaryVerificationData {
  verificationResult: VerificationResult;
  verificationMetadata: VerificationMetadata;
  proof: SummaryProof;
  requestHash: string;
  responseHash: string;
}

export const createSummaryVerificationId = () => `summary-${randomUUID()}`;

export async function finalizeSummaryVerification(
  context: SummaryVerificationContext
): Promise<SummaryVerificationData> {
  const {
    origin,
    model,
    verificationId,
    requestBody,
    responseText,
    chatId,
    requestHash: providedRequestHash,
  } = context;

  const requestHash = providedRequestHash ?? sha256sum(requestBody);
  const responseHash = sha256sum(responseText);

  const verificationResult =
    chatId != null
      ? await verifyChatMessage(requestBody, responseText, model)
      : {
          verified: false,
          chatId: "",
          requestHash,
          responseHash,
          signature: null,
          hashValidation: null,
          signatureValidation: null,
          error: "Missing chat ID from NEAR AI response",
        };

  const signaturePayload = verificationResult.signature
    ? {
        text: verificationResult.signature.text,
        signature: verificationResult.signature.signature,
        signing_address: verificationResult.signature.signing_address,
        signing_algo: verificationResult.signature.signing_algo,
      }
    : null;

  const mappedResult: VerificationResult = {
    verified: verificationResult.verified,
    reasons: verificationResult.error ? [verificationResult.error] : [],
    status: verificationResult.verified ? "verified" : "failed",
    warnings: verificationResult.error ? [verificationResult.error] : undefined,
    signature: signaturePayload,
    requestHash: verificationResult.requestHash,
    responseHash: verificationResult.responseHash,
    chatId: verificationResult.chatId || null,
  };

  const verificationMetadata: VerificationMetadata = {
    source: "near-ai-cloud",
    status: mappedResult.status ?? "failed",
    messageId: verificationResult.chatId || verificationId,
    requestHash: verificationResult.requestHash,
    responseHash: verificationResult.responseHash,
    chatId: verificationResult.chatId || undefined,
  };

  const proof: SummaryProof = {
    requestHash,
    responseHash,
    chatId: verificationResult.chatId || null,
    verified: verificationResult.verified,
  };

  if (!verificationResult.verified && origin) {
    logger.debug("[summaryVerification] Verification incomplete", {
      origin,
      verificationId,
      status: mappedResult.status,
    });
  }

  return {
    verificationResult: mappedResult,
    verificationMetadata,
    proof,
    requestHash,
    responseHash,
  };
}
