import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
import { getNearAIClient } from "@/lib/near-ai";
import { NearAIError } from "@/lib/near-ai";
import { NEAR_AI_MODELS } from "@/utils/model-utils";
import type { SummaryProof, TextSummaryResponse } from "@/types/summaries";
import type { VerificationMetadata } from "@/types/verification";

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

    if (!summary) {
      throw new Error("AI response was empty");
    }

    const proofNonce = session.nonce;
    const proof: SummaryProof = {
      requestHash,
      responseHash,
      nonce: proofNonce,
    };

    const verificationResult = await client.verifyChatPayload({
      requestBody,
      responseText,
      chatId: data?.id ?? generatedVerificationId,
      model: MODEL,
    });

    const verificationMetadata: VerificationMetadata = {
      source: "near-ai-cloud",
      status: verificationResult.status ?? "pending",
      messageId: verificationResult.chatId ?? data?.id ?? generatedVerificationId,
    };

    const response: TextSummaryResponse = {
      success: true,
      summary: summary.trim(),
      model: MODEL,
      cached: false,
      verification: verificationMetadata,
      verificationId: verificationMetadata.messageId,
      proof,
      verificationResult,
    };

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
