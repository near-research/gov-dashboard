import { describe, it, expect, vi, afterEach } from "vitest";

import {
  registerVerificationSession,
  buildCompletionRequest,
} from "@/server/agent/verification-flow";
import { getNearAIClient } from "@/lib/near-ai";

describe("agent verification flow", () => {
  const runtimeBaseUrl = "https://runtime.example.com";

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers session without fetching when iteration is zero", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = getNearAIClient();
    const createSessionSpy = vi.spyOn(client, "createSession");
    const updateHashesSpy = vi.spyOn(client, "updateSessionHashes");

    const result = await registerVerificationSession({
      runtimeBaseUrl,
      baseVerificationId: "agent-base",
      requestHash: "hash-one",
      iteration: 0,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createSessionSpy).toHaveBeenCalledWith("agent-base", undefined);
    expect(updateHashesSpy).toHaveBeenCalledWith("agent-base", {
      requestHash: "hash-one",
    });
    expect(result).toEqual({
      verificationId: "agent-base",
      nonce: undefined,
    });
  });

  it("registers a round session with nonce retrieval for later iterations", async () => {
    const nonceResponse = { nonce: "round-nonce" };
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue(nonceResponse),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = getNearAIClient();
    const createSessionSpy = vi.spyOn(client, "createSession");
    const updateHashesSpy = vi.spyOn(client, "updateSessionHashes");

    const result = await registerVerificationSession({
      runtimeBaseUrl,
      baseVerificationId: "agent-base",
      requestHash: "hash-two",
      iteration: 2,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${runtimeBaseUrl}/api/verification/session`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ verificationId: "agent-base-round-2" }),
      })
    );
    expect(createSessionSpy).toHaveBeenCalledWith(
      "agent-base-round-2",
      "round-nonce"
    );
    expect(updateHashesSpy).toHaveBeenCalledWith("agent-base-round-2", {
      requestHash: "hash-two",
    });
    expect(result).toEqual({
      verificationId: "agent-base-round-2",
      nonce: "round-nonce",
    });
  });

  it("builds completion requests that include tools and options", () => {
    const completion = buildCompletionRequest({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "stub-tool" }],
      toolChoice: "auto",
    });

    expect(completion.requestBodyString).toContain("test-model");
    expect(completion.requestBodyString).toContain("stub-tool");
    expect(completion.requestBodyString).toContain("tool_choice");
    expect(completion.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
