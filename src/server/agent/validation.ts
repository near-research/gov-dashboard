import type { NextApiRequest } from "next";
import { z } from "zod";
import { generateId } from "./ids";
import type { AgentRequestBody, ValidatedAgentRequest } from "./types";
import type { MessageRole } from "@/types/agui-events";
import { logger } from "@/lib/logger";
import { servicesConfig } from "@/config/services";
import { DISCOURSE_URLS } from "@/constants/services";

const MAX_REQUEST_BYTES = 200_000; // ~200KB guardrail to prevent oversized payloads

const isDev = process.env.NODE_ENV === "development";

const messageRoles: readonly MessageRole[] = [
  "developer",
  "system",
  "assistant",
  "user",
  "tool",
] as const;

function headerValueToString(
  value: string | string[] | undefined
): string | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function getAllowedBaseUrls(): string[] {
  return [
    process.env.APP_BASE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.SITE_URL,
    servicesConfig.discourseBaseUrl,
    ...Object.values(DISCOURSE_URLS),
    "https://staging.gov.near.org",
    "http://localhost:3000",
  ]
    .filter(Boolean)
    .map((value) => value!.trim());
}

function isAllowedBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return getAllowedBaseUrls().some((allowed) => {
      const allowedParsed = new URL(allowed);
      return parsed.origin === allowedParsed.origin;
    });
  } catch {
    return false;
  }
}

export function getRuntimeBaseUrl(req?: NextApiRequest): string {
  const envBaseUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.SITE_URL;
  if (envBaseUrl) {
    return envBaseUrl;
  }

  if (req) {
    const origin = headerValueToString(req.headers.origin);
    if (origin && isAllowedBaseUrl(origin)) {
      return origin;
    }

    const host = headerValueToString(req.headers.host);
    if (host) {
      const forwardedProto = headerValueToString(
        req.headers["x-forwarded-proto"]
      );
      const protocol = forwardedProto || "https";
      const candidateUrl = `${protocol}://${host}`;
      if (isAllowedBaseUrl(candidateUrl)) {
        return candidateUrl;
      }
    }
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  throw new Error(
    "Unable to determine runtime base URL. Set APP_BASE_URL environment variable."
  );
}

export function logRuntimeInfo(context: string, data: Record<string, unknown>) {
  if (isDev) {
    logger.debug(`[${context}]`, data);
  }
}
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
  parentRunId: z.string().optional(),
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
  let runtimeBaseUrl: string;
  try {
    runtimeBaseUrl = getRuntimeBaseUrl(req);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error:
        error instanceof Error
          ? error.message
          : "Unable to determine runtime base URL",
    };
  }

  logRuntimeInfo("Agent", {
    messagesCount: body.messages?.length,
    hasState: !!body.state,
    hasApiKey: !!process.env.NEAR_AI_CLOUD_API_KEY,
  });

  return { ok: true, body, thread, run, runtimeBaseUrl };
}
