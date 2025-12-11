import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
import { getNearAIClient } from "@/lib/near-ai";
import { NearAIError } from "@/lib/near-ai";
import { NEAR_AI_MODELS } from "@/utils/model-utils";
import { getModelExpectations } from "@/server/attestation-cache";
import type { SummaryProof, TextSummaryResponse } from "@/types/summaries";
import type {
  VerificationAttestationPayload,
  VerificationProofResponse,
} from "@/types/verification";
import { extractVerificationMetadata } from "@/verification/normalize";
import { normalizeVerificationPayload } from "@/verification/normalize";
import { mergeVerificationStatusFromProof } from "@/server/verificationUtils";
import { normalizeVerificationResult } from "@/utils/verification/shared";

const MODEL = NEAR_AI_MODELS.DEEPSEEK_V3_1;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TextSummaryResponse | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const client = getNearAIClient();
    const prompt = `In a few sentences, tell me something I don't know.`;
    const nearRequest = {
      model: MODEL,
      messages: [
        {
          role: "system",
          content: "You are a good teacher. Keep things concise.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 300,
      stream: false,
    };
    const requestBody = JSON.stringify(nearRequest);
    const requestHash = createHash("sha256").update(requestBody).digest("hex");
    const generatedVerificationId = `test-${randomBytes(8).toString("hex")}`;
    const session = client.createSession(generatedVerificationId);

    let expectations = null;
    try {
      expectations = await getModelExpectations(MODEL);
    } catch (err) {
      console.warn(
        "[verification test] Failed to fetch model expectations",
        err
      );
    }

    const data = await client.chatCompletions(nearRequest, {
      verificationId: generatedVerificationId,
      verificationNonce: session.nonce,
    });

    const responseText = JSON.stringify(data);
    const responseHash = createHash("sha256")
      .update(responseText)
      .digest("hex");
    const summary =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.delta?.content ||
      "";

    const rawVerification = extractVerificationMetadata(data);
    const nearMessageId = data?.id || generatedVerificationId;
    const { verification, verificationId: normalizedVerificationId } =
      normalizeVerificationPayload(rawVerification, nearMessageId);
    const effectiveVerificationId =
      normalizedVerificationId || generatedVerificationId;

    client.updateSessionHashes(generatedVerificationId, {
      requestHash,
      responseHash,
    });

    if (effectiveVerificationId !== generatedVerificationId) {
      client.createSession(effectiveVerificationId, session.nonce);
      client.updateSessionHashes(effectiveVerificationId, {
        requestHash,
        responseHash,
      });
    }

    if (!summary) {
      throw new Error("AI response was empty");
    }

    let proofNonce = session.nonce;
    const proof: SummaryProof = {
      requestHash,
      responseHash,
      nonce: proofNonce,
      arch: expectations?.arch,
      deviceCertHash: expectations?.deviceCertHash,
      rimHash: expectations?.rimHash ?? undefined,
      ueid: expectations?.ueid ?? undefined,
      measurements: expectations?.measurements ?? undefined,
    };

    const response: TextSummaryResponse = {
      success: true,
      summary: summary.trim(),
      model: MODEL,
      cached: false,
      verification,
      verificationId: effectiveVerificationId,
      proof,
    };

    let remoteProof: VerificationProofResponse | null = null;
    try {
      const verificationResult = await client.verify({
        verificationId: effectiveVerificationId,
        model: MODEL,
        chatId: data?.id,
        requestHash,
        responseHash,
      });

      const verificationSession = client.getSession(effectiveVerificationId);
      proofNonce = verificationSession?.nonce ?? proofNonce;
      proof.nonce = proofNonce;

      const attestation = verificationResult.attestation as
        | VerificationAttestationPayload
        | undefined;

      remoteProof = {
        attestation,
        signature: verificationResult.signature ?? null,
        signatureVerification: verificationResult.signatureVerification ?? null,
        nras: verificationResult.nras ?? null,
        nonceCheck: verificationResult.nonceCheck ?? null,
        intel: verificationResult.intel ?? null,
        attestationNodes: verificationResult.attestationNodes ?? null,
        configMissing: verificationResult.configMissing ?? undefined,
        verified: verificationResult.verified,
        reasons: verificationResult.reasons ?? [],
        results: verificationResult.results ?? undefined,
        requestHash,
        responseHash,
        sessionRequestHash: session.requestHash ?? null,
        sessionResponseHash: session.responseHash ?? null,
        normalized: normalizeVerificationResult(verificationResult),
        nonce: proofNonce,
      };
    } catch (err) {
      console.warn("[verification] Prefetch proof failed:", err);
    }

    if (remoteProof) {
      response.remoteProof = remoteProof;
      response.verification =
        mergeVerificationStatusFromProof(response.verification, remoteProof) ??
        response.verification;
    }

    return res.status(200).json(response);
  } catch (error: unknown) {
    console.error("[verification test] Error:", error);

    if (error instanceof NearAIError) {
      const statusCode = error.statusCode ?? 500;
      const message = `NEAR AI Cloud API Error: ${statusCode}`;
      return res.status(statusCode).json({ error: message });
    }

    return res.status(500).json({ error: "Unable to respond" });
  }
}
