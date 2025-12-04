import { describe, it, expect } from "vitest";
import {
  NEAR_AI_MODELS,
  isValidModel,
  getModelInfo,
  calculateCost,
} from "@/utils/model-utils";

describe("model-utils", () => {
  it("validates model ids case-sensitively", () => {
    expect(isValidModel(NEAR_AI_MODELS.GPT_OSS_120B)).toBe(true);
    expect(isValidModel("openai/GPT-OSS-120B")).toBe(false);
    expect(getModelInfo("openai/GPT-OSS-120B")).toBeNull();
  });

  it("returns cost based on token counts", () => {
    const cost = calculateCost(NEAR_AI_MODELS.DEEPSEEK_V3_1, 500_000, 250_000);
    // 0.5 * 1.0 + 0.25 * 2.5 = 0.5 + 0.625 = 1.125
    expect(cost).toBeCloseTo(1.125, 3);
  });

  it("returns null for unknown model info", () => {
    expect(getModelInfo("unknown")).toBeNull();
  });
});
