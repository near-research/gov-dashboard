import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import handler from "@/pages/api/chat/completions";
import type { ChatVerificationResult, NearAIClient } from "@/lib/near-ai";
import * as nearAI from "@/lib/near-ai";
import { EventEmitter } from "events";
import { createNearAiClientMock } from "../mocks/near-ai-client";
import {
  serializeChatCompletionRequest,
  type NormalizedChatCompletionRequest,
} from "@/lib/near-ai/request";

const { NearAIError, NearAITimeoutError } = nearAI;
const nearAIClientMock = createNearAiClientMock();
const { chatCompletions: chatSpy, chatCompletionsStream: streamSpy } =
  nearAIClientMock;
const getNearAIClientSpy = vi.spyOn(nearAI, "getNearAIClient");
const verifyChatMessageMock = vi.spyOn(nearAI, "verifyChatMessage");

const createMockVerificationResult = (
  overrides: Partial<ChatVerificationResult> = {}
): ChatVerificationResult => ({
  verified: true,
  chatId: "mock-chat-id",
  requestHash: "mock-request-hash",
  responseHash: "mock-response-hash",
  signature: null,
  hashValidation: null,
  signatureValidation: null,
  attestation: null,
  ...overrides,
});

const createResponse = () => {
  const emitter = new EventEmitter();
  const bodyChunks: Buffer[] = [];
  const res = Object.assign(emitter, {
    statusCode: 0,
    headers: {} as Record<string, any>,
    body: undefined as any,
    writableEnded: false,
    setHeader(key: string, value: any) {
      this.headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.writableEnded = true;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      this.writableEnded = true;
      return this;
    },
    write(chunk: any) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Uint8Array);
      bodyChunks.push(buf);
      return true;
    },
    getBody() {
      if (this.body !== undefined) return this.body;
      return Buffer.concat(bodyChunks).toString();
    },
    end() {
      this.writableEnded = true;
      emitter.emit("close");
      return this;
    },
  }) as EventEmitter & {
    statusCode: number;
    headers: Record<string, any>;
    body: any;
    writableEnded: boolean;
    setHeader: (key: string, value: any) => void;
    status: (code: number) => typeof res;
    json: (payload: any) => typeof res;
    send: (payload: any) => typeof res;
    write: (chunk: any) => true;
    getBody: () => any;
    end: () => typeof res;
  };
  return res;
};

const createRequest = (body: any, overrides: Record<string, unknown> = {}) => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    method: "POST",
    body,
    headers: {},
    ...overrides,
  });
};

describe("POST /api/chat/completions", () => {
  beforeEach(() => {
    chatSpy.mockReset();
    chatSpy.mockResolvedValue({ id: "abc", choices: [] });
    streamSpy.mockReset();
    getNearAIClientSpy.mockReset();
    getNearAIClientSpy.mockReturnValue(
      nearAIClientMock as unknown as NearAIClient
    );
    verifyChatMessageMock.mockReset();
    verifyChatMessageMock.mockResolvedValue(
      createMockVerificationResult()
    );
  });

  it("rejects invalid bodies with 400", async () => {
    const req = createRequest({ messages: [] });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe("Invalid request body");
  });

  it("rejects oversized bodies with 413", async () => {
    const huge = "x".repeat(210_000);
    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: huge }],
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(413);
    expect(res.body?.error).toBe("Request too large");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("proxies valid non-streaming requests through the NearAI client", async () => {
    const reqBody: NormalizedChatCompletionRequest = {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    };
    const req = createRequest(reqBody);
    const requestBodyString = serializeChatCompletionRequest(reqBody);
    const res = createResponse();
    const verificationResult = createMockVerificationResult({
      chatId: "abc",
    });
    verifyChatMessageMock.mockResolvedValueOnce(verificationResult);

    await handler(req as any, res as any);

    expect(chatSpy).toHaveBeenCalledWith(reqBody, {
      timeout: undefined,
      serializedBody: requestBodyString,
    });
    const responseText = JSON.stringify({ id: "abc", choices: [] });
    expect(verifyChatMessageMock).toHaveBeenCalledWith(
      requestBodyString,
      responseText,
      "m"
    );
    expect(res.statusCode).toBe(200);
    expect(res.body?.id).toBe("abc");
    expect(res.body?.verification).toBe(verificationResult);
  });

  it("attaches the verification result from the NEAR AI client", async () => {
    const reqBody: NormalizedChatCompletionRequest = {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    };
    const responseData = {
      id: "resp-123",
      choices: [],
    };
    const verificationResult = createMockVerificationResult({
      chatId: "resp-123",
    });
    chatSpy.mockResolvedValue(responseData);
    verifyChatMessageMock.mockResolvedValueOnce(verificationResult);
    const responseText = JSON.stringify(responseData);

    const req = createRequest(reqBody);
    const res = createResponse();

    await handler(req as any, res as any);

    expect(verifyChatMessageMock).toHaveBeenCalledWith(
      serializeChatCompletionRequest(reqBody),
      responseText,
      "m"
    );
    expect(res.body?.verification).toBe(verificationResult);
  });

  it("streams responses with upstream content-type and hashes streamed payloads", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: one\n\n"));
        controller.enqueue(encoder.encode("data: two\n\n"));
        controller.close();
      },
    });

    streamSpy.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    );

    const requestBody: NormalizedChatCompletionRequest = {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const requestBodyString = serializeChatCompletionRequest(requestBody);

    const req = createRequest(requestBody);
    const res = createResponse();
    const expectedVerificationResult = createMockVerificationResult();
    verifyChatMessageMock.mockResolvedValueOnce(expectedVerificationResult);

    await handler(req as any, res as any);

    expect(streamSpy).toHaveBeenCalledWith(requestBody, {
      serializedBody: requestBodyString,
    });
    expect(res.headers["Content-Type"]).toContain("text/event-stream");
    expect(res.headers["Cache-Control"]).toBe("no-cache, no-transform");
    expect(res.headers["Connection"]).toBe("keep-alive");
    expect(res.headers["X-Accel-Buffering"]).toBe("no");
    const verificationChunk = JSON.stringify({
      verification: expectedVerificationResult,
    });
    expect(res.getBody()).toBe(
      "data: one\n\ndata: two\n\n" +
        `data: ${verificationChunk}\n\n` +
        "data: [DONE]\n\n"
    );

    expect(verifyChatMessageMock).toHaveBeenCalledWith(
      requestBodyString,
      "data: one\n\ndata: two\n\n",
      "m"
    );
  });

  it("bubbles NEAR AI streaming failures into JSON error responses", async () => {
    streamSpy.mockRejectedValueOnce(
      new NearAIError("Stream failed unexpectedly", 502)
    );

    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(streamSpy).toHaveBeenCalled();
    const [firstStreamBody] = streamSpy.mock.calls[0];
    expect(firstStreamBody).toEqual(
      expect.objectContaining({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      })
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      error: "NEAR AI Cloud API Error: 502",
      details: "Stream failed unexpectedly",
    });
  });

  it("hashes the decoder flush chunk in streamed responses", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Intentionally send an incomplete UTF-8 sequence so TextDecoder.flush() emits a replacement char.
        controller.enqueue(Uint8Array.from([0xe2]));
        controller.close();
      },
    });

    streamSpy.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    );

    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    const res = createResponse();

    await handler(req as any, res as any);

    const flushedRequest: NormalizedChatCompletionRequest = {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };

    expect(verifyChatMessageMock).toHaveBeenCalledWith(
      serializeChatCompletionRequest(flushedRequest),
      "�",
      "m"
    );
  });

  it("returns 500 when the NEAR AI client is not configured", async () => {
    getNearAIClientSpy.mockImplementationOnce(() => {
      throw new Error("NEAR_AI_CLOUD_API_KEY missing");
    });
    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body?.error).toBe("API key not configured on server");
  });

  it("propagates NearAI authentication failures (expired token)", async () => {
    chatSpy.mockRejectedValueOnce(
      new NearAIError("Token expired", 401, { type: "unauthorized" })
    );
    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toBe("NEAR AI Cloud API Error: 401");
    expect(res.body?.details).toBe("Token expired");
  });

  it("returns 429 when NearAI enforces rate limits", async () => {
    chatSpy.mockRejectedValueOnce(
      new NearAIError("Rate limit exceeded", 429, { retryAfter: 60 })
    );
    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(429);
    expect(res.body?.error).toBe("NEAR AI Cloud API Error: 429");
  });

  it("maps NearAITimeoutError to a 504 response", async () => {
    chatSpy.mockRejectedValueOnce(new NearAITimeoutError("Timed out waiting"));
    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(504);
    expect(res.body?.error).toBe("Request timeout");
    expect(res.body?.details).toBe("Timed out waiting");
  });

  it("sends negotiated tool metadata when provided", async () => {
    const tools = [
      {
        type: "function",
        function: {
          name: "fetch-url",
          description: "Fetch remote data",
          parameters: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Target URL to fetch",
              },
            },
            required: ["url"],
          },
        },
      },
    ];
    const toolChoice = {
      type: "function",
      function: { name: "fetch-url" },
    };
    const reqBody = {
      model: "deepseek-ai/DeepSeek-V3.1",
      messages: [{ role: "user", content: "go fetch" }],
      tools,
      tool_choice: toolChoice,
    };
    const req = createRequest(reqBody);
    const res = createResponse();

    await handler(req as any, res as any);

    const [forwarded] = chatSpy.mock.calls[0];
    expect(forwarded.tools).toEqual(tools);
    expect(forwarded.tool_choice).toEqual(toolChoice);
    expect(res.statusCode).toBe(200);
  });

  it("keeps tool_choice unset when the payload explicitly passes null", async () => {
    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      tool_choice: null,
    });
    const res = createResponse();

    await handler(req as any, res as any);

    const [forwarded] = chatSpy.mock.calls[0];
    expect(forwarded).not.toHaveProperty("tool_choice");
    expect(res.statusCode).toBe(200);
  });

  it("formats unexpected errors as generic NEAR AI Cloud API failures", async () => {
    chatSpy.mockRejectedValueOnce(new Error("upstream boom"));
    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: "NEAR AI Cloud API Error",
      details: "upstream boom",
    });
  });

  it("rejects requests with an empty model value", async () => {
    const req = createRequest({
      model: "",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body?.message).toContain(">=1 characters");
  });
});
