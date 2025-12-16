import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextApiResponse } from "next";
import { createNearAiClientMock } from "../mocks/near-ai-client";
import type { ChatVerificationResult, NearAIClient } from "@/lib/near-ai";
import { NEAR_AI_MODELS } from "@/utils/model-utils";
import { siwnRecipient } from "@/config/siwn";
import {
  ScreeningError,
  verifyNearAuth,
  requestEvaluation,
  respondWithScreeningError,
  clearScreeningCache,
} from "@/server/screening";
import { ErrorCodes } from "@/lib/api/errors";
import type { Evaluation } from "@/types/evaluation";

vi.mock("near-sign-verify", () => ({
  verify: vi.fn(),
}));
vi.mock("@/lib/near-ai", async () => {
  const actual = await vi.importActual("@/lib/near-ai");
  return {
    ...actual,
    getNearAIClient: vi.fn(),
    verifyChatMessage: vi.fn(),
  };
});

import { verify } from "near-sign-verify";
import {
  getNearAIClient,
  verifyChatMessage,
  NearAIError,
} from "@/lib/near-ai";

const evaluationTemplate = (): Evaluation => ({
  complete: { pass: true, reason: "complete" },
  legible: { pass: true, reason: "legible" },
  consistent: { pass: true, reason: "consistent" },
  compliant: { pass: true, reason: "compliant" },
  justified: { pass: true, reason: "justified" },
  measurable: { pass: true, reason: "measurable" },
  relevant: { score: "high", reason: "relevant" },
  material: { score: "medium", reason: "material" },
  qualityScore: 0.9,
  attentionScore: 0.85,
  overallPass: true,
  summary: "All criteria satisfied.",
});

const createChatResponse = (content: string, includeId = true) => ({
  id: includeId ? "chat-123" : undefined,
  object: "chat.completion",
  created: 1,
  model: "screening-model",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    },
  ],
});

const createVerificationResult = (
  overrides: Partial<ChatVerificationResult> = {}
): ChatVerificationResult => ({
  verified: true,
  chatId: "chat-123",
  requestHash: "req",
  responseHash: "res",
  signature: null,
  hashValidation: null,
  signatureValidation: null,
  attestation: null,
  ...overrides,
});

const nearAiClientMock = createNearAiClientMock();
const getNearAIClientMock = vi.mocked(getNearAIClient);
const verifyChatMessageMock = vi.mocked(verifyChatMessage);
const verifyMock = vi.mocked(verify);

beforeEach(() => {
  vi.clearAllMocks();
  clearScreeningCache();
  getNearAIClientMock.mockReturnValue(
    nearAiClientMock as unknown as NearAIClient
  );
  nearAiClientMock.chatCompletions.mockReset();
  verifyChatMessageMock.mockReset();
  verifyChatMessageMock.mockResolvedValue(createVerificationResult());
});

const createResponse = (): NextApiResponse =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse);

describe("verifyNearAuth", () => {
  it("requires bearer token", async () => {
    await expect(verifyNearAuth(undefined)).rejects.toMatchObject({
      statusCode: 401,
      details: expect.objectContaining({ code: "missing_token" }),
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("verifies valid tokens and forwards options", async () => {
    const resultPayload = {
      accountId: "alice.near",
      message: "screened",
      publicKey: "pk",
    };
    verifyMock.mockResolvedValue(resultPayload);

    const { token, result } = await verifyNearAuth("Bearer valid-token", {
      nonceMaxAge: 1000,
    });

    expect(token).toBe("valid-token");
    expect(result.accountId).toBe("alice.near");
    expect(verifyMock).toHaveBeenCalledWith(
      "valid-token",
      expect.objectContaining({
        expectedRecipient: siwnRecipient,
        nonceMaxAge: 1000,
      })
    );
  });

  it("handles invalid tokens", async () => {
    verifyMock.mockRejectedValue(new Error("expired"));
    await expect(verifyNearAuth("Bearer invalid")).rejects.toMatchObject({
      statusCode: 401,
      details: expect.objectContaining({ code: "invalid_token" }),
    });
  });
});

describe("requestEvaluation", () => {
  const evaluationJson = JSON.stringify(evaluationTemplate());

  it("returns evaluation and verification info", async () => {
    const responseData = createChatResponse(evaluationJson);
    nearAiClientMock.chatCompletions.mockResolvedValue(responseData);

    const result = await requestEvaluation("My title", "My content");

    expect(result.evaluation.summary).toBe("All criteria satisfied.");
    expect(result.evaluation.model).toBe(NEAR_AI_MODELS.GPT_OSS_120B);
    expect(result.chatId).toBe("chat-123");
    expect(result.verificationResult).toEqual(
      expect.objectContaining({ chatId: "chat-123", verified: true })
    );
    expect(verifyChatMessageMock).toHaveBeenCalledWith(
      result.requestBody,
      result.responseText,
      result.model
    );
    expect(JSON.parse(result.responseText)).toEqual(responseData);
  });

  it("reuses cached evaluations for identical inputs", async () => {
    const responseData = createChatResponse(evaluationJson);
    nearAiClientMock.chatCompletions.mockResolvedValue(responseData);

    const firstResult = await requestEvaluation("My title", "My content");
    const secondResult = await requestEvaluation("My title", "My content");

    expect(nearAiClientMock.chatCompletions).toHaveBeenCalledTimes(1);
    expect(verifyChatMessageMock).toHaveBeenCalledTimes(1);
    expect(secondResult).toBe(firstResult);
    expect(secondResult.verificationResult).toBe(firstResult.verificationResult);
  });

  it("uses failed verification when chat id is missing", async () => {
    const responseData = createChatResponse(evaluationJson, false);
    nearAiClientMock.chatCompletions.mockResolvedValue(responseData);

    const result = await requestEvaluation("Title", "Content");

    expect(result.verificationResult.verified).toBe(false);
    expect(result.verificationResult.error).toContain("Missing chat ID");
    expect(result.verificationId).toBeNull();
    expect(verifyChatMessageMock).not.toHaveBeenCalled();
  });

  it("throws when AI returns no content", async () => {
    nearAiClientMock.chatCompletions.mockResolvedValue({
      id: "chat-123",
      object: "chat.completion",
      created: 1,
      model: "screening-model",
      choices: [],
    });

    await expect(requestEvaluation("Title", "Content")).rejects.toMatchObject({
      statusCode: 500,
      message: "Empty response from AI",
    });
  });

  it("wraps NEAR AI errors", async () => {
    nearAiClientMock.chatCompletions.mockRejectedValue(
      new NearAIError("Rate limited", 429, { code: "rate_limit" })
    );

    await expect(requestEvaluation("Title", "Content")).rejects.toMatchObject({
      statusCode: 502,
      message: "AI evaluation unavailable",
    });
  });

  it("handles non-error rejections", async () => {
    nearAiClientMock.chatCompletions.mockRejectedValue("boom");

    await expect(requestEvaluation("Title", "Content")).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to evaluate proposal",
    });
  });
});

describe("respondWithScreeningError", () => {
  it("serializes ScreeningError", () => {
    const res = createResponse();
    const error = new ScreeningError(418, "no soup", {
      message: "fallback",
    });

    respondWithScreeningError(res, error, "details");

    expect(res.status).toHaveBeenCalledWith(418);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ErrorCodes.INTERNAL_ERROR,
        message: "details",
        statusCode: 418,
      })
    );
  });

  it("falls back to generic error shape", () => {
    const res = createResponse();

    respondWithScreeningError(res, new Error("bad"), "fallback");

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: ErrorCodes.INTERNAL_ERROR,
      message: "fallback",
      statusCode: 500,
    });
  });
});
