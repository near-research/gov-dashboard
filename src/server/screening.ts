import type { NextApiResponse } from "next";
import type { Evaluation } from "@/types/evaluation";
import { evaluationSchema } from "@/types/evaluation";
import { buildScreeningPrompt } from "@/lib/prompts/screenProposal";
import {
  getNearAIClient,
  verifyChatMessage,
  NearAIError,
  type ChatVerificationResult,
} from "@/lib/near-ai";
import {
  normalizeChatCompletionRequest,
  serializeChatCompletionRequest,
} from "@/lib/near-ai/request";
import {
  verify,
  type VerificationResult as NearAuthVerificationResult,
  type VerifyOptions,
} from "near-sign-verify";
import { NEAR_AI_MODELS } from "@/utils/model-utils";
import { sha256sum } from "@/lib/near-ai/verification/hash";
import { siwnRecipient } from "@/config/siwn";
import { logger } from "@/lib/logger";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";

type ScreeningErrorDetails = {
  code?: string;
  message?: string;
  details?: unknown;
  body?: string;
  status?: number;
  statusText?: string;
  [key: string]: unknown;
};

export class ScreeningError extends ApiError {
  constructor(
    statusCode: number,
    message: string,
    details?: ScreeningErrorDetails,
    code: keyof typeof ErrorCodes = ErrorCodes.INTERNAL_ERROR
  ) {
    super(code, message, statusCode, details);
  }
}

export const MAX_TITLE_LENGTH = 500;
export const MAX_CONTENT_LENGTH = 32000;
const PROMPT_CONTENT_LIMIT = MAX_CONTENT_LENGTH;

const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/g;

const extractJsonFragments = (text: string): Set<string> => {
  const fragments = new Set<string>();

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") {
      continue;
    }

    let depth = 0;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }

      if (depth === 0) {
        fragments.add(text.slice(start, index + 1));
        break;
      }
    }
  }

  return fragments;
};

const normalizeSsePayload = (text: string): string | null => {
  if (!text) {
    return null;
  }

  const sanitizedLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (!/^data:/i.test(line)) {
        return line;
      }
      const withoutPrefix = line.replace(/^data:\s*/i, "");
      return withoutPrefix.trim() === "[DONE]" ? "" : withoutPrefix;
    })
    .filter((line) => line.length > 0);

  return sanitizedLines.length > 0 ? sanitizedLines.join("\n") : null;
};

export const parseEvaluation = (raw: string): Evaluation => {
  const trimmed = (raw || "").trim();
  const candidates = new Set<string>();

  if (trimmed) {
    candidates.add(trimmed);
    const normalizedSse = normalizeSsePayload(trimmed);
    if (normalizedSse) {
      candidates.add(normalizedSse);
    }
    extractJsonFragments(trimmed).forEach((fragment) =>
      candidates.add(fragment)
    );
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const validated = evaluationSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // continue to next candidate
    }
  }

  throw new ScreeningError(
    500,
    "Could not parse evaluation response",
    { body: raw },
    ErrorCodes.UPSTREAM_ERROR
  );
};

export function sanitizeProposalInput(
  title?: string,
  content?: string
): { title: string; content: string } {
  if (!title || !title.trim()) {
      throw new ScreeningError(
        400,
        "Proposal title is required",
        undefined,
        ErrorCodes.VALIDATION_ERROR
      );
  }

  if (!content || !content.trim()) {
    throw new ScreeningError(
      400,
      "Proposal text is required",
      undefined,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw new ScreeningError(
      400,
      `Title too long (max ${MAX_TITLE_LENGTH} characters)`,
      undefined,
      ErrorCodes.VALIDATION_ERROR
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
    logger.debug("[Screening] sending chars:", sanitizedContent.length);
  }

  return {
    title: sanitizedTitle,
    content: sanitizedContent,
  };
}

export async function verifyNearAuth(
  authHeader: string | undefined,
  options?: VerifyOptions
): Promise<{ token: string; result: NearAuthVerificationResult }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ScreeningError(
      401,
      "NEAR authentication required",
      { code: "missing_token" },
      ErrorCodes.UNAUTHORIZED
    );
  }

  const token = authHeader.substring(7);

  try {
    const verifyOptions = {
      expectedRecipient: siwnRecipient,
      nonceMaxAge: 5 * 60 * 1000,
      ...(options || {}),
    } as VerifyOptions;

    const result = await verify(token, verifyOptions);
    return { token, result };
  } catch (error: unknown) {
    const details =
      error instanceof Error ? error.message : "Unknown verification error";
    throw new ScreeningError(
      401,
      "Invalid authentication",
      { code: "invalid_token", details },
      ErrorCodes.UNAUTHORIZED
    );
  }
}

export interface EvaluationRequestResult {
  evaluation: Evaluation;
  verificationResult: ChatVerificationResult;
  model: string;
  chatId?: string | null;
  verificationId?: string | null;
  requestBody: string;
  responseText: string;
}

const SCREENING_CACHE_TTL_MS = 5 * 60 * 1000;
type EvaluationCacheEntry = {
  result: EvaluationRequestResult;
  expiresAt: number;
};

const screeningCache = new Map<string, EvaluationCacheEntry>();

const buildScreeningCacheKey = (title: string, content: string): string =>
  sha256sum(`${title}\n${content}`);

export function clearScreeningCache(): void {
  screeningCache.clear();
}

function getScreeningCache(key: string): EvaluationRequestResult | null {
  const entry = screeningCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    screeningCache.delete(key);
    return null;
  }

  return entry.result;
}

function cacheScreeningResult(key: string, result: EvaluationRequestResult): void {
  screeningCache.set(key, {
    result,
    expiresAt: Date.now() + SCREENING_CACHE_TTL_MS,
  });
}

const buildFailedVerificationResult = (
  message: string
): ChatVerificationResult => ({
  verified: false,
  chatId: "",
  requestHash: "",
  responseHash: "",
  signature: null,
  hashValidation: null,
  signatureValidation: null,
  attestation: null,
  error: message,
});

export async function requestEvaluation(
  title: string,
  content: string
): Promise<EvaluationRequestResult> {
  const cacheKey = buildScreeningCacheKey(title, content);
  const cached = getScreeningCache(cacheKey);
  if (cached) {
    logger.debug("[Screening] Returning cached evaluation", {
      cacheKey,
      titleLength: title.length,
      contentLength: content.length,
    });
    return cached;
  }

  const client = getNearAIClient();
  const prompt = buildScreeningPrompt(title, content);

  const model = NEAR_AI_MODELS.GPT_OSS_120B;
  const normalizedRequest = normalizeChatCompletionRequest({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    stream: false,
  });
  const requestBodyString = serializeChatCompletionRequest(normalizedRequest);

  try {
    const data = await client.chatCompletions(normalizedRequest, {
      serializedBody: requestBodyString,
    });
    const responseText = JSON.stringify(data);
    const contentText = data.choices?.[0]?.message?.content;

    if (!contentText) {
      throw new ScreeningError(
        500,
        "Empty response from AI",
        undefined,
        ErrorCodes.UPSTREAM_ERROR
      );
    }

    const evaluation = parseEvaluation(contentText);
    evaluation.model = model;

    const chatId = data?.id ?? null;
    const verificationResult = chatId
      ? await verifyChatMessage(requestBodyString, responseText, model)
      : buildFailedVerificationResult("Missing chat ID from NEAR AI response");

    const result: EvaluationRequestResult = {
      evaluation,
      verificationResult,
      model,
      chatId,
      verificationId: chatId,
      requestBody: requestBodyString,
      responseText,
    };

    cacheScreeningResult(cacheKey, result);
    logger.debug("[Screening] Cached evaluation result", {
      cacheKey,
      titleLength: title.length,
      contentLength: content.length,
    });

    return result;
  } catch (error) {
    if (error instanceof ScreeningError) {
      throw error;
    }

    if (error instanceof NearAIError) {
      logger.error("[Screening] NEAR AI request failed", {
        statusCode: error.statusCode,
        details: error.details,
      });
      throw new ScreeningError(
        502,
        "AI evaluation unavailable",
        {
          cause: error,
          statusCode: error.statusCode,
          details: error.details
            ? typeof error.details === "string"
              ? error.details
              : JSON.stringify(error.details)
            : undefined,
        },
        ErrorCodes.UPSTREAM_ERROR
      );
    }

    if (error instanceof Error) {
      logger.error("[Screening] NEAR AI API error:", error.message);
      const statusCategory =
        error.message.includes("timeout") || error.message.includes("504")
          ? "NEAR AI timed out while evaluating the proposal. Please try again or shorten the content."
          : "NEAR AI API error";
      throw new ScreeningError(
        502,
        statusCategory,
        { message: error.message, details: error.message },
        ErrorCodes.UPSTREAM_ERROR
      );
    }

    throw new ScreeningError(
      500,
      "Failed to evaluate proposal",
      { message: error instanceof Error ? error.message : "Unknown error" },
      ErrorCodes.INTERNAL_ERROR
    );
  }
}

export function respondWithScreeningError(
  res: NextApiResponse,
  error: unknown,
  fallbackMessage?: string
) {
  if (error instanceof ScreeningError) {
    const responseError =
      fallbackMessage && fallbackMessage.length
        ? new ApiError(
            error.code,
            fallbackMessage,
            error.statusCode,
            error.details
          )
        : error;
    return respondWithError(res, responseError);
  }

  logger.error("[Screening] Unexpected error:", error);
  const message = fallbackMessage || "Failed to evaluate proposal";
  const details =
    error instanceof Error ? error.message : typeof error === "string" ? error : error;

  return respondWithError(
    res,
    new ApiError(ErrorCodes.INTERNAL_ERROR, message, 500, details)
  );
}
