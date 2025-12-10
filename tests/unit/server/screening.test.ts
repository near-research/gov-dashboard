import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fc from "fast-check";
import type { Evaluation } from "@/types/evaluation";
import {
  parseEvaluation,
  ScreeningError,
  MAX_CONTENT_LENGTH,
  requestEvaluation,
  sanitizeProposalInput,
  verifyNearAuth,
} from "@/server/screening";
import { NEAR_AI_MODELS } from "@/utils/model-utils";
import { NearAITimeoutError } from "@/lib/near-ai";
import { verify as verifyNearToken } from "near-sign-verify";
import { siwnRecipient } from "@/config/siwn";

const mockChatCompletions = vi.fn();
const createSessionSpy = vi.fn();
const updateSessionHashesSpy = vi.fn();

vi.mock("@/lib/near-ai/client", () => ({
  getNearAIClient: () => ({
    chatCompletions: mockChatCompletions,
    createSession: createSessionSpy,
    updateSessionHashes: updateSessionHashesSpy,
  }),
}));

vi.mock("near-sign-verify", () => ({
  verify: vi.fn(),
}));

const evaluationFixture: Evaluation = {
  complete: { pass: true, reason: "complete" },
  legible: { pass: true, reason: "legible" },
  consistent: { pass: true, reason: "consistent" },
  compliant: { pass: true, reason: "compliant" },
  justified: { pass: true, reason: "justified" },
  measurable: { pass: true, reason: "measurable" },
  relevant: { score: "high", reason: "relevant" },
  material: { score: "medium", reason: "material" },
  qualityScore: 0.8,
  attentionScore: 0.75,
  overallPass: true,
  summary: "Test summary",
};

describe("screening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatCompletions.mockReset();
    createSessionSpy.mockReset();
    createSessionSpy.mockReturnValue({
      nonce: "mock-nonce",
    });
    updateSessionHashesSpy.mockReset();
  });

  it("sanitizes control characters, strips HTML, and truncates long content", () => {
    const longHtml =
      "<p>Hello\x7f<br/>World</p>" + "a".repeat(MAX_CONTENT_LENGTH + 20);

    const { title, content } = sanitizeProposalInput(
      " \x01Test Title ",
      longHtml
    );

    expect(title).toBe("Test Title");
    expect(content).not.toContain("<p>");
    expect(content).not.toContain("\x7f");
    expect(content).toContain("\n");
    expect(content).toContain("[... content truncated for screening ...]");
    expect(content.length).toBeGreaterThan(MAX_CONTENT_LENGTH);
  });

  it("verifies NEAR auth tokens", async () => {
    const mockedVerify = verifyNearToken as unknown as ReturnType<typeof vi.fn>;
    mockedVerify.mockResolvedValue({ ok: true } as any);

    const { token, result } = await verifyNearAuth("Bearer test-token");

    expect(token).toBe("test-token");
    expect(result).toEqual({ ok: true });
    expect(mockedVerify).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({
        expectedRecipient: siwnRecipient,
      })
    );
  });

  it("throws ScreeningError on invalid auth tokens", async () => {
    const mockedVerify = verifyNearToken as unknown as ReturnType<typeof vi.fn>;
    mockedVerify.mockRejectedValue(new Error("invalid token"));

    await expect(verifyNearAuth("Bearer bad")).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid authentication",
    });
  });

  it("throws when auth header is missing", async () => {
    await expect(verifyNearAuth(undefined)).rejects.toMatchObject({
      statusCode: 401,
      message: "NEAR authentication required",
      details: { code: "missing_token" },
    });
  });

  it("returns evaluation details and verification metadata", async () => {
    mockChatCompletions.mockResolvedValue({
      id: "verification-123",
      choices: [
        {
          message: {
            content: JSON.stringify({
              complete: { pass: true, reason: "ok" },
              legible: { pass: true, reason: "ok" },
              consistent: { pass: true, reason: "ok" },
              compliant: { pass: true, reason: "ok" },
              justified: { pass: true, reason: "ok" },
              measurable: { pass: true, reason: "ok" },
              relevant: { score: "high", reason: "ok" },
              material: { score: "medium", reason: "ok" },
              summary: "summary",
              overallPass: true,
              qualityScore: 0.9,
              attentionScore: 0.8,
            }),
          },
        },
      ],
    });

    const result = await requestEvaluation("Title", "Content");

    expect(result.evaluation).toEqual(
      expect.objectContaining({
        overallPass: true,
        qualityScore: 0.9,
        attentionScore: 0.8,
        model: NEAR_AI_MODELS.GPT_OSS_120B,
      })
    );
    expect(result.verificationId).toBe("verification-123");
    expect(result.verification?.nonce).toBeDefined();
    expect(createSessionSpy).toHaveBeenCalledWith("verification-123");
    expect(updateSessionHashesSpy).toHaveBeenCalledWith(
      "verification-123",
      expect.objectContaining({
        requestHash: expect.any(String),
      })
    );
  });

  it("wraps NEAR AI timeouts in ScreeningError", async () => {
    mockChatCompletions.mockRejectedValue(new Error("504 gateway timeout"));

    await expect(requestEvaluation("Title", "Content")).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("NEAR AI timed out"),
    });
  });

  it("wraps NearAITimeoutError in ScreeningError timeout messaging", async () => {
    mockChatCompletions.mockRejectedValue(
      new NearAITimeoutError("Cloud request timed out")
    );

    expect.assertions(4);

    try {
      await requestEvaluation("Title", "Content");
      throw new Error("Expected requestEvaluation to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScreeningError);
      expect((error as ScreeningError).statusCode).toBe(502);
      expect((error as Error).message).toBe("NEAR AI API error");
      expect((error as ScreeningError).details?.message).toBe(
        "Cloud request timed out"
      );
    }
  });

  it("throws when the AI response delivers no message content", async () => {
    mockChatCompletions.mockResolvedValue({
      choices: [],
    });

    await expect(requestEvaluation("Title", "Content")).rejects.toMatchObject({
      statusCode: 500,
      message: "Empty response from AI",
    });
  });

  it("fails on malformed AI responses", async () => {
    mockChatCompletions.mockResolvedValue({
      choices: [
        {
          message: { content: "not-json" },
        },
      ],
    });

    await expect(requestEvaluation("Title", "Content")).rejects.toMatchObject({
      statusCode: 500,
      message: "Could not parse evaluation response",
    });
  });

  it("wraps unknown rejections in a generic ScreeningError", async () => {
    mockChatCompletions.mockRejectedValue("boom!");

    await expect(requestEvaluation("Title", "Content")).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to evaluate proposal",
      details: { message: "Unknown error" },
    });
  });

  describe("parseEvaluation helper", () => {
    const evaluationJson = JSON.stringify(evaluationFixture);

    it("parses evaluation even when wrapped in prose", () => {
      const decorated = `
        Here is the analysis:
        ${evaluationJson}
        Please flag issues.
      `;

      expect(parseEvaluation(decorated)).toEqual(evaluationFixture);
    });

    it("extracts evaluation JSON from SSE-style data lines", () => {
      const sseStream = [
        "data: context line\n",
        `data: ${evaluationJson}\n`,
        "data: [DONE]\n",
      ].join("");

      expect(parseEvaluation(sseStream)).toEqual(evaluationFixture);
    });

    it("robustly parses evaluation when JSON appears anywhere", () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 16 }),
          fc.string({ maxLength: 16 }),
          (prefix, suffix) => {
            const input = `${prefix}${evaluationJson}${suffix}`;
            expect(parseEvaluation(input)).toEqual(evaluationFixture);
          }
        ),
        { numRuns: 32 }
      );
    });
  });
});
