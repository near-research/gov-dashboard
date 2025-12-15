import { z } from "zod";

const completionMessageSchema = z
  .object({
    role: z.string().min(1),
    content: z.union([z.string(), z.null()]).optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.unknown()).optional(),
  })
  .strip();

const toolChoiceFunctionSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().min(1),
      })
      .strip(),
  })
  .strip();

export const toolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  toolChoiceFunctionSchema,
]);

const toolSchema = z
  .object({
    type: z.string(),
  })
  .catchall(z.unknown());

export const chatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(completionMessageSchema).min(1),
    stream: z.boolean().optional().default(false),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    top_p: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    tools: z.array(toolSchema).optional(),
    tool_choice: toolChoiceSchema.optional(),
  })
  .strip();

export type NormalizedChatCompletionRequest = z.infer<
  typeof chatCompletionRequestSchema
>;

export type ChatCompletionRequestInput = z.input<
  typeof chatCompletionRequestSchema
>;

export const normalizeChatCompletionRequest = (
  payload: z.input<typeof chatCompletionRequestSchema>
): NormalizedChatCompletionRequest => {
  return chatCompletionRequestSchema.parse(payload);
};

export const serializeChatCompletionRequest = (
  payload: NormalizedChatCompletionRequest
): string => {
  return stableJsonStringify(payload);
};

const stableJsonStringify = (value: unknown): string => {
  const normalized = normalizeValueForSerialization(value);
  return JSON.stringify(normalized);
};

const normalizeValueForSerialization = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return value;
  }

  if (valueType === "bigint") {
    throw new TypeError("BigInt values are not supported in completion requests");
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = normalizeValueForSerialization(item);
      return typeof normalized === "undefined" ? null : normalized;
    });
  }

  if (valueType === "object") {
    const objectValue = value as Record<string, unknown>;
    const toJson = typeof (value as { toJSON?: () => unknown }).toJSON === "function";
    if (toJson) {
      return normalizeValueForSerialization(
        (value as { toJSON: () => unknown }).toJSON()
      );
    }

    const entries = Object.keys(objectValue)
      .filter((key) => typeof objectValue[key] !== "undefined")
      .sort()
      .map<[string, unknown] | undefined>((key) => {
        const normalized = normalizeValueForSerialization(objectValue[key]);
        if (typeof normalized === "undefined") {
          return undefined;
        }
        return [key, normalized];
      })
      .filter((entry): entry is [string, unknown] => entry !== undefined);

    return Object.fromEntries(entries);
  }

  throw new TypeError(
    `Unsupported value type for serialization: ${valueType}`
  );
};
