/**
 * NEAR AI Cloud Model Configuration
 */

export const NEAR_AI_MODELS = {
  DEEPSEEK_V3_1: "deepseek-ai/DeepSeek-V3.1",
  GPT_OSS_120B: "openai/gpt-oss-120b",
  QWEN3_30B: "Qwen/Qwen3-30B-A3B-Instruct-2507",
  GLM_4_6_FP8: "Zhipu/GLM-4.6-FP8",
} as const;

export type NearAIModel = (typeof NEAR_AI_MODELS)[keyof typeof NEAR_AI_MODELS];

interface ModelInfo {
  id: NearAIModel;
  name: string;
  contextWindow: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  description: string;
  bestFor: string[];
}

export const MODEL_INFO: Record<NearAIModel, ModelInfo> = {
  [NEAR_AI_MODELS.DEEPSEEK_V3_1]: {
    id: NEAR_AI_MODELS.DEEPSEEK_V3_1,
    name: "DeepSeek V3.1",
    contextWindow: 128_000,
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 2.5,
    description: "Hybrid thinking mode, excellent tool calling",
    bestFor: ["general-purpose", "tool-calling", "agent-tasks"],
  },
  [NEAR_AI_MODELS.GPT_OSS_120B]: {
    id: NEAR_AI_MODELS.GPT_OSS_120B,
    name: "GPT OSS 120B",
    contextWindow: 131_000,
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.6,
    description: "OpenAI's open-weight MoE, best value",
    bestFor: ["reasoning", "agents", "budget-conscious"],
  },
  [NEAR_AI_MODELS.QWEN3_30B]: {
    id: NEAR_AI_MODELS.QWEN3_30B,
    name: "Qwen3 30B A3B",
    contextWindow: 262_000,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.45,
    description: "Ultra-long context, multilingual",
    bestFor: ["long-documents", "multilingual", "cheapest"],
  },
  [NEAR_AI_MODELS.GLM_4_6_FP8]: {
    id: NEAR_AI_MODELS.GLM_4_6_FP8,
    name: "GLM-4.6 FP8",
    contextWindow: 131_000,
    inputPricePerMillion: 0.75,
    outputPricePerMillion: 2.0,
    description: "Premium quality, advanced coding",
    bestFor: ["coding", "complex-reasoning", "premium"],
  },
};

export function isValidModel(model: string): model is NearAIModel {
  return Object.values(NEAR_AI_MODELS).includes(model as NearAIModel);
}

export function getModelInfo(model: string): ModelInfo | null {
  if (!isValidModel(model)) return null;
  return MODEL_INFO[model];
}

export function calculateCost(
  model: NearAIModel,
  inputTokens: number,
  outputTokens: number
): number {
  const info = MODEL_INFO[model];
  const inputCost = (inputTokens / 1_000_000) * info.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * info.outputPricePerMillion;
  return inputCost + outputCost;
}
