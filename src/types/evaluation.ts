import { z } from "zod";

const evaluationCriterionSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
});

const attentionScoreSchema = z.object({
  score: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});

export const evaluationSchema = z.object({
  complete: evaluationCriterionSchema,
  legible: evaluationCriterionSchema,
  consistent: evaluationCriterionSchema,
  compliant: evaluationCriterionSchema,
  justified: evaluationCriterionSchema,
  measurable: evaluationCriterionSchema,
  relevant: attentionScoreSchema,
  material: attentionScoreSchema,
  qualityScore: z.number(),
  attentionScore: z.number(),
  overallPass: z.boolean(),
  summary: z.string(),
  model: z.string().optional(),
});

export type Evaluation = z.infer<typeof evaluationSchema>;
