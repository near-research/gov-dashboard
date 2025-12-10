import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  NearAIClient,
  createNearAIClient,
  getNearAIClient,
  resetNearAIClient,
} from "@/lib/near-ai";
import {
  NearAIConfigurationError,
  NearAIError,
  NearAITimeoutError,
} from "@/lib/near-ai";

const requestPayload = { model: "test-model", messages: [] };

describe("NearAIClient", () => {
  const originalFetch = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
    resetNearAIClient();
    delete (process.env as any).NEAR_AI_CLOUD_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    (global as any).fetch = originalFetch;
    resetNearAIClient();
  });

  it("reconfigures the singleton when options change", () => {
    const first = getNearAIClient({ apiKey: "one", baseUrl: "https://one" });
    const second = getNearAIClient({ apiKey: "two" });

    expect(second).not.toBe(first);
    expect(second.getConfig().apiKey).toBe("two");
    expect(second.getConfig().baseUrl).toBe("https://one");

    resetNearAIClient();
    const fresh = getNearAIClient({
      apiKey: "three",
      baseUrl: "https://three",
    });
    expect(fresh.getConfig().apiKey).toBe("three");
    expect(fresh.getConfig().baseUrl).toBe("https://three");
  });

  it("throws configuration errors lazily when API key is missing", async () => {
    const client = new NearAIClient();
    const result = client.chatCompletions(requestPayload);

    await expect(result).rejects.toBeInstanceOf(NearAIConfigurationError);
  });

  it("attaches verification headers and parses successful responses", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    const client = new NearAIClient({
      apiKey: "key-123",
      baseUrl: "https://api",
    });
    await client.chatCompletions(requestPayload, {
      verificationId: "ver-id",
      verificationNonce: "nonce",
      requestId: "req-1",
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key-123");
    expect(headers["X-Verification-Id"]).toBe("ver-id");
    expect(headers["X-Nonce"]).toBe("nonce");
    expect(headers["X-Request-Id"]).toBe("req-1");
  });

  it("generates a request id when none provided", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    const client = new NearAIClient({
      apiKey: "key-123",
      baseUrl: "https://api",
    });
    await client.chatCompletions(requestPayload);

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toMatch(/[0-9a-f-]{8,}/i);
  });

  it("parses non-200 responses into NearAIError", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"error":"rate limited"}',
    });

    const client = new NearAIClient({ apiKey: "key-123" });
    const result = client.chatCompletions(requestPayload);

    await expect(result).rejects.toMatchObject({
      statusCode: 429,
      details: "rate limited",
    });
  });

  it("rejects with NearAITimeoutError when the request exceeds the timeout", async () => {
    const abortError = new Error("aborted");
    (abortError as any).name = "AbortError";
    fetchMock.mockRejectedValue(abortError);

    const client = new NearAIClient({ apiKey: "key-123", timeout: 10 });
    await expect(client.chatCompletions(requestPayload)).rejects.toBeInstanceOf(
      NearAITimeoutError
    );
  });

  it("retries failed requests with backoff", async () => {
    vi.useRealTimers();
    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      });

    const client = new NearAIClient({
      apiKey: "key-123",
      timeout: 50,
    });

    const promise = client.chatCompletions(requestPayload, {
      retryAttempts: 1,
      retryBaseDelayMs: 5,
    });

    const result = await promise;
    expect(result.choices?.[0]?.message?.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("applies retry defaults configured on the singleton", async () => {
    vi.useRealTimers();
    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      });

    const client = getNearAIClient({
      apiKey: "key-123",
      retryAttempts: 1,
      retryBaseDelayMs: 1,
    });

    await client.chatCompletions(requestPayload);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not bleed per-call retry overrides into later requests", async () => {
    vi.useRealTimers();
    const client = getNearAIClient({ apiKey: "key-123" });

    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      });

    await client.chatCompletions(requestPayload, {
      retryAttempts: 1,
      retryBaseDelayMs: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error("network"));

    await expect(client.chatCompletions(requestPayload)).rejects.toBeInstanceOf(
      NearAIError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("streams responses with verification headers and enforces the stream flag", async () => {
    const mockResponse = { ok: true, status: 200, body: {} };
    fetchMock.mockResolvedValue(mockResponse);

    const client = new NearAIClient({ apiKey: "stream-key" });
    const response = await client.chatCompletionsStream(
      { model: "stream-model", messages: [] },
      {
        verificationId: "ver",
        verificationNonce: "nonce",
      }
    );

    expect(response).toBe(mockResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer stream-key");
    expect(headers["X-Verification-Id"]).toBe("ver");
    expect(headers["X-Nonce"]).toBe("nonce");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("stream-model");
    expect(body.stream).toBe(true);
  });

  it("parses streaming errors when the response body is plain text", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "service busy",
    });

    const client = new NearAIClient({ apiKey: "stream-key" });
    await expect(
      client.chatCompletionsStream({ model: "stream-model", messages: [] })
    ).rejects.toMatchObject({
      statusCode: 503,
      details: "service busy",
    });
  });

  it("wraps streaming aborts in NearAITimeoutError", async () => {
    const abortError = new Error("stream aborted");
    (abortError as any).name = "AbortError";
    fetchMock.mockRejectedValue(abortError);

    const client = new NearAIClient({ apiKey: "stream-key", timeout: 10 });
    await expect(
      client.chatCompletionsStream({ model: "stream-model", messages: [] })
    ).rejects.toBeInstanceOf(NearAITimeoutError);
  });

  it("wraps unexpected streaming failures in NearAIError", async () => {
    fetchMock.mockRejectedValue(new Error("stream crack"));

    const client = new NearAIClient({ apiKey: "stream-key" });
    await expect(
      client.chatCompletionsStream({ model: "stream-model", messages: [] })
    ).rejects.toMatchObject({
      message: "stream crack",
    });
  });

  it("createNearAIClient returns a fresh instance unrelated to the singleton", () => {
    const globalClient = getNearAIClient({ apiKey: "global" });
    const isolatedClient = createNearAIClient({
      apiKey: "refresh",
      baseUrl: "https://fresh",
    });

    expect(isolatedClient).not.toBe(globalClient);
    expect(isolatedClient.getConfig().apiKey).toBe("refresh");
    expect(globalClient.getConfig().apiKey).toBe("global");
  });
});
