import type { NextApiRequest } from "next";
import { z } from "zod";
import { generateId } from "./ids";
import type { AgentRequestBody, ValidatedAgentRequest } from "./types";
import type { MessageRole } from "@/types/agui-events";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || process.env.SITE_URL || "";

const MAX_REQUEST_BYTES = 200_000; // ~200KB guardrail to prevent oversized payloads

const messageRoles: readonly MessageRole[] = [
  "developer",
  "system",
  "assistant",
  "user",
  "tool",
] as const;

const agentRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(messageRoles),
        content: z.string().min(1, "content is required"),
      })
    )
    .min(1, "messages array is required"),
  threadId: z.string().optional(),
  runId: z.string().optional(),
  state: z.unknown().optional(),
  verificationId: z.string().optional(),
  verificationNonce: z.string().optional(),
});

export function validateAgentRequest(req: NextApiRequest): ValidatedAgentRequest {
  const rawBody = JSON.stringify(req.body ?? {});
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Request body exceeds maximum size",
    };
  }

  const parsed = agentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  const body = parsed.data as AgentRequestBody;
  const thread = body.threadId || generateId("thread");
  const run = body.runId || generateId("run");
  const runtimeBaseUrl =
    APP_BASE_URL ||
    req.headers.origin ||
    (req.headers.host ? `http://${req.headers.host}` : "http://localhost:3000");

  console.log("[Agent] API called with:", {
    messagesCount: body.messages?.length,
    hasState: !!body.state,
    hasApiKey: !!process.env.NEAR_AI_CLOUD_API_KEY,
  });

  return { ok: true, body, thread, run, runtimeBaseUrl };
}
