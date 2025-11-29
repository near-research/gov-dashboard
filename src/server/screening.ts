import type { NextApiResponse } from "next";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";
import {
  extractVerificationMetadata,
  normalizeVerificationPayload,
} from "@/utils/verification";
import { buildScreeningPrompt } from "@/lib/prompts/screenProposal";
import {
  verify,
  type VerificationResult,
  type VerifyOptions,
} from "near-sign-verify";
import { getNearAIClient } from "@/lib/near-ai/client";
import { NEAR_AI_MODELS } from "@/utils/model-utils";

type ScreeningErrorDetails = {
  code?: string;
  message?: string;
  details?: string;
  body?: string;
  status?: number;
  statusText?: string;
  [key: string]: unknown;
};

export class ScreeningError extends Error {
  statusCode: number;
  details?: ScreeningErrorDetails;

  constructor(
    statusCode: number,
    message: string,
    details?: ScreeningErrorDetails
  ) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const MAX_TITLE_LENGTH = 500;
export const MAX_CONTENT_LENGTH = 32000;
const PROMPT_CONTENT_LIMIT = MAX_CONTENT_LENGTH;

const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/g;

export function sanitizeProposalInput(
  title?: string,
  content?: string
): { title: string; content: string } {
  if (!title || !title.trim()) {
    throw new ScreeningError(400, "Proposal title is required");
  }

  if (!content || !content.trim()) {
    throw new ScreeningError(400, "Proposal text is required");
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw new ScreeningError(
      400,
      `Title too long (max ${MAX_TITLE_LENGTH} characters)`
    );
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw new ScreeningError(
      400,
      `Proposal too long (max ${MAX_CONTENT_LENGTH} characters)`
    );
  }

  const sanitize = (text: string) =>
    text.trim().replace(CONTROL_CHAR_REGEX, "");

  const sanitizedTitle = sanitize(title);
  let sanitizedContent = sanitize(content);
  sanitizedContent = sanitizedContent
    .replace(/<br\s*\/?>(?=\s|$)/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r?\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (sanitizedContent.length > PROMPT_CONTENT_LIMIT) {
    sanitizedContent =
      sanitizedContent.slice(0, PROMPT_CONTENT_LIMIT) +
      "\n\n[... content truncated for screening ...]";
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[Screening] sending chars:", sanitizedContent.length);
  }

  return {
    title: sanitizedTitle,
    content: sanitizedContent,
  };
}

export async function verifyNearAuth(
  authHeader: string | undefined,
  options?: VerifyOptions
): Promise<{ token: string; result: VerificationResult }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ScreeningError(401, "NEAR authentication required", {
      code: "missing_token",
    });
  }

  const token = authHeader.substring(7);

  try {
    const verifyOptions = {
      expectedRecipient: "social.near",
      nonceMaxAge: 5 * 60 * 1000,
      ...(options || {}),
    } as VerifyOptions;

    const result = await verify(token, verifyOptions);
    return { token, result };
  } catch (error: unknown) {
    const details =
      error instanceof Error ? error.message : "Unknown verification error";
    throw new ScreeningError(401, "Invalid authentication", {
      code: "invalid_token",
      details,
    });
  }
}

export interface EvaluationRequestResult {
  evaluation: Evaluation;
  verification?: VerificationMetadata;
  verificationId?: string;
  model: string;
}

export async function requestEvaluation(
  title: string,
  content: string
): Promise<EvaluationRequestResult> {
  const client = getNearAIClient();
  const prompt = buildScreeningPrompt(title, content);

  const model = NEAR_AI_MODELS.GPT_OSS_120B;

  try {
    const data = await client.chatCompletions({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const contentText = data.choices?.[0]?.message?.content;

    if (!contentText) {
      throw new ScreeningError(500, "Empty response from AI");
    }

    const jsonMatch = contentText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ScreeningError(500, "Could not parse evaluation response");
    }

    const evaluation: Evaluation = JSON.parse(jsonMatch[0]);

    if (
      evaluation.overallPass === undefined ||
      evaluation.qualityScore === undefined ||
      evaluation.attentionScore === undefined
    ) {
      throw new ScreeningError(
        500,
        "Invalid evaluation structure returned by AI"
      );
    }

    evaluation.model = model;

    const verificationRaw = extractVerificationMetadata(data);
    const verificationMessageId = data?.id ?? undefined;
    const { verification, verificationId } = normalizeVerificationPayload(
      verificationRaw,
      verificationMessageId
    );

    return {
      evaluation,
      verification,
      verificationId: verificationId ?? undefined,
      model,
    };
  } catch (error) {
    // Handle NEAR AI client errors
    if (error instanceof Error) {
      console.error("[Screening] NEAR AI API error:", error.message);
      
      const statusCategory =
        error.message.includes("timeout") || error.message.includes("504")
          ? "NEAR AI timed out while evaluating the proposal. Please try again or shorten the content."
          : "NEAR AI API error";

      throw new ScreeningError(502, statusCategory, {
        message: error.message,
        details: error.message,
      });
    }

    // Re-throw ScreeningError as-is
    if (error instanceof ScreeningError) {
      throw error;
    }

    // Unknown error
    throw new ScreeningError(500, "Failed to evaluate proposal", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function respondWithScreeningError(
  res: NextApiResponse,
  error: unknown,
  fallbackMessage?: string
) {
  if (error instanceof ScreeningError) {
    const detailMessage =
      fallbackMessage ??
      [error.details?.details, error.details?.message, error.details?.body]
        .filter((value): value is string => typeof value === "string")
        .find((value) => value.length > 0) ??
      error.message;
    return res.status(error.statusCode).json({
      error: error.message,
      message: detailMessage,
      details:
        process.env.NODE_ENV === "development" ? error.details : undefined,
    });
  }

  console.error("[Screening] Unexpected error:", error);
  return res.status(500).json({
    error: "Failed to evaluate proposal",
    message: fallbackMessage || "An unexpected error occurred",
  });
}
