import { z } from "zod";

// Base message schema describes the roles, optional content, and optional tool calls.
const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })
    )
    .optional(),
});

// Each choice includes an index, the returned message, and the finish reason.
const choiceSchema = z.object({
  index: z.number(),
  message: messageSchema,
  finish_reason: z
    .enum(["stop", "length", "tool_calls", "content_filter"])
    .nullable(),
});

// Usage stats are optional in some responses.
const usageSchema = z
  .object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  })
  .optional();

export const chatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number(),
  model: z.string(),
  choices: z.array(choiceSchema),
  usage: usageSchema,
});

export const nearAIErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.string().optional(),
  }),
});

export const nearAIResponseSchema = z.union([
  chatCompletionResponseSchema,
  nearAIErrorResponseSchema,
]);

export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;
export type NearAIErrorResponse = z.infer<typeof nearAIErrorResponseSchema>;
export type NearAIResponse = z.infer<typeof nearAIResponseSchema>;
