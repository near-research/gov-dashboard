import { describe, expect, it } from "vitest";
import type { NextApiRequest } from "next";
import { validateAgentRequest } from "@/server/agent/validation";

const buildRequest = (overrides: Partial<NextApiRequest> = {}) =>
  ({
    body: {
      messages: [{ role: "user", content: "hello" }],
    },
    headers: { host: "example.com" },
    method: "POST",
    ...overrides,
  } as unknown as NextApiRequest);

describe("validateAgentRequest", () => {
  it("returns ok when messages exist", () => {
    const validated = validateAgentRequest(buildRequest());
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.thread.startsWith("thread_")).toBe(true);
      expect(validated.run.startsWith("run_")).toBe(true);
      expect(validated.runtimeBaseUrl).toBeDefined();
      expect(validated.runtimeBaseUrl.startsWith("http")).toBe(true);
    }
  });

  it("rejects missing messages", () => {
    const request = buildRequest({ body: { messages: [] } as any });
    const validated = validateAgentRequest(request);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.status).toBe(400);
      expect(validated.error).toContain("messages array");
    }
  });

  it("rejects empty message content", () => {
    const request = buildRequest({
      body: { messages: [{ role: "user", content: "" }] } as any,
    });
    const validated = validateAgentRequest(request);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.status).toBe(400);
      expect(validated.error).toContain("content is required");
    }
  });

  it("rejects oversized payloads", () => {
    const largeContent = "a".repeat(200_001);
    const request = buildRequest({
      body: { messages: [{ role: "user", content: largeContent }] } as any,
    });
    const validated = validateAgentRequest(request);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.status).toBe(413);
      expect(validated.error).toContain("maximum size");
    }
  });
});
