import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";

vi.mock("@/server/agent/streaming", () => ({
  getStreamingResponse: vi.fn(),
  consumeStream: vi.fn(),
}));
vi.mock("@/server/agent/tools", () => ({
  executeToolCallsWithEvents: vi.fn(),
}));
vi.mock("@/server/agent/verification-flow", () => ({
  performSecondCompletion: vi.fn(),
  finalizeVerifications: vi.fn(),
}));

const mockNearAIClient = {
  chatCompletions: vi.fn(),
  chatCompletionsStream: vi.fn(),
  getConfig: () => ({ baseUrl: "https://api.near.ai", apiKey: "key" }),
};
vi.mock("@/lib/near-ai/client", () => ({
  getNearAIClient: () => mockNearAIClient,
  createNearAIClient: () => mockNearAIClient,
}));

import { PassThrough } from "stream";
import type { NextApiRequest, NextApiResponse } from "next";

import handler from "@/pages/api/agent";
import chatHandler from "@/pages/api/chat/completions";
import { EventType } from "@/types/agui-events";
import * as streamingModule from "@/server/agent/streaming";
import * as toolsModule from "@/server/agent/tools";
import * as verificationFlowModule from "@/server/agent/verification-flow";
import * as verificationServer from "@/verification/server";

type StreamingModuleType = typeof streamingModule;
const mockedStreamingModule = streamingModule as unknown as {
  getStreamingResponse: MockedFunction<StreamingModuleType["getStreamingResponse"]>;
  consumeStream: MockedFunction<StreamingModuleType["consumeStream"]>;
};

const mockedToolsModule = toolsModule as unknown as {
  executeToolCallsWithEvents: MockedFunction<
    typeof toolsModule.executeToolCallsWithEvents
  >;
};

const mockedVerificationFlowModule = verificationFlowModule as unknown as {
  performSecondCompletion: MockedFunction<
    typeof verificationFlowModule.performSecondCompletion
  >;
  finalizeVerifications: MockedFunction<
    typeof verificationFlowModule.finalizeVerifications
  >;
};

const createSseRequest = () => {
  const req = new PassThrough() as unknown as NextApiRequest;
  req.method = "POST";
  req.headers = { host: "example.org" } as any;
  req.socket = { remoteAddress: "127.0.0.1" } as any;
  req.body = {
    messages: [{ role: "user", content: "Summarize NEAR governance" }],
    verificationId: "agent-ver-1",
    verificationNonce: "nonce-abc",
    threadId: "thread-1",
    runId: "run-1",
  };
  return req;
};

const createSseResponse = () => {
  const res = new PassThrough() as unknown as NextApiResponse & {
    events: string[];
    getText: () => string;
  };
  res.events = [];
  const originalWrite = (res.write.bind(res) as unknown) as (
    chunk: any,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void
  ) => boolean;
  res.write = ((chunk: any, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
    res.events.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof encoding === "function") {
      return originalWrite(chunk, encoding);
    }
    const actualEncoding =
      typeof encoding === "string" ? (encoding as BufferEncoding) : undefined;
    return originalWrite(chunk, actualEncoding, cb);
  }) as typeof res.write;
  const headerStore: Record<string, string> = {};
  (res as any).headers = headerStore;
  res.setHeader = ((key: string, value: string | number | readonly string[]) => {
    headerStore[key] = String(value);
    return res;
  }) as typeof res.setHeader;
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as typeof res.status;
  res.flushHeaders = vi.fn();
  res.getText = () => res.events.join("");
  return res;
};

const parseSseEvents = (res: ReturnType<typeof createSseResponse>) =>
  res
    .getText()
    .split("data: ")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\n\n$/, ""))
    .map((line) => JSON.parse(line));

const { verificationService } = verificationServer;

describe("agent SSE + chat streaming integration", () => {
  let updateHashesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.NEAR_AI_CLOUD_API_KEY = "test-key";
    vi.resetAllMocks();
    mockedStreamingModule.consumeStream.mockReset();
    mockedStreamingModule.getStreamingResponse.mockResolvedValue(
      new Response(null, { status: 200 })
    );
    updateHashesSpy = vi.spyOn(verificationService, "updateHashes");
  });

  afterEach(() => {
    updateHashesSpy.mockRestore();
  });

  it("streams AGENT events, runs tool calls, and records verification hashes", async () => {
    const firstResult = {
      content: "Initial reasoning",
      toolCalls: [
        {
          id: "tool-1",
          type: "function",
          function: { name: "mock_tool", arguments: "{}", id: "tool-1" },
        },
      ],
      finishReason: "tool_calls",
      verificationId: "initial-ver-id",
      toolStepStarted: true,
    };
    const secondResult = {
      content: "Second pass",
      finishReason: "stop",
      verificationId: "remote-ver-id",
      toolStepStarted: false,
    };

    const verificationPayload = {
      verificationId: "final-proof-id",
      requestHash: "req-hash",
      responseHash: "res-hash",
    };

    mockedStreamingModule.consumeStream
      .mockImplementationOnce(async ({ writeEvent }) => {
        writeEvent({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "Hello first pass",
          timestamp: Date.now(),
        });
        return firstResult;
      })
      .mockResolvedValueOnce(secondResult);

    mockedToolsModule.executeToolCallsWithEvents.mockResolvedValue([
      { role: "tool", content: "tool out", tool_call_id: "tool-1" },
    ]);

    mockedVerificationFlowModule.performSecondCompletion.mockResolvedValue({
      secondId: "second-verification",
      nonce: "nonce",
      remoteVerificationId: "remote-ver-id",
    });

    mockedVerificationFlowModule.finalizeVerifications.mockImplementation(
      async ({
        writeEvent,
      }: Parameters<typeof verificationFlowModule.finalizeVerifications>[0]) => {
      writeEvent({
        type: EventType.CUSTOM,
        name: "verification",
        value: verificationPayload,
        timestamp: Date.now(),
      });
    });

    const req = createSseRequest();
    const res = createSseResponse();

    const streamPromise = handler(req, res);

    await new Promise<void>((resolve) => res.on("finish", resolve));
    await streamPromise;

    const events = parseSseEvents(res);

    expect(events.some((evt) => evt.type === EventType.RUN_STARTED)).toBe(true);
    expect(events.some((evt) => evt.type === EventType.STEP_FINISHED)).toBe(true);
    expect(events.some((evt) => evt.type === EventType.RUN_FINISHED)).toBe(true);
    expect(events.some((evt) => evt.type === EventType.TEXT_MESSAGE_CONTENT)).toBe(true);

    const verificationEvent = events.find(
      (evt) => evt.type === EventType.CUSTOM && evt.name === "verification"
    );
    expect(verificationEvent).toBeDefined();
    expect(verificationEvent?.value).toEqual(verificationPayload);
    expect(updateHashesSpy).toHaveBeenCalledWith(verificationPayload.verificationId, {
      requestHash: verificationPayload.requestHash,
      responseHash: verificationPayload.responseHash,
    });
    expect(mockedToolsModule.executeToolCallsWithEvents).toHaveBeenCalled();
    expect(mockedVerificationFlowModule.performSecondCompletion).toHaveBeenCalled();
  });

  it("registers the verification session and forwards it to the streaming client", async () => {
    const registerSessionSpy = vi.spyOn(
      verificationService,
      "registerSession"
    );
    mockedStreamingModule.consumeStream.mockResolvedValueOnce({
      content: "Reasoning output",
      finishReason: "stop",
      verificationId: "run-ver-id",
      toolStepStarted: false,
    } as any);

    const req = createSseRequest();
    const res = createSseResponse();

    const streamPromise = handler(req, res);
    await new Promise<void>((resolve) => res.on("finish", resolve));
    await streamPromise;

    expect(registerSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationId: "agent-ver-1",
        nonce: "nonce-abc",
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );

    expect(mockedStreamingModule.consumeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionVerificationId: "agent-ver-1",
      })
    );

    const events = parseSseEvents(res);
    expect(events.some((evt) => evt.type === EventType.RUN_STARTED)).toBe(true);
    expect(events.some((evt) => evt.type === EventType.RUN_FINISHED)).toBe(true);
    registerSessionSpy.mockRestore();
  });

  it("surfaces AGENT errors via RUN_ERROR events and closes the stream", async () => {
    mockedStreamingModule.consumeStream.mockImplementationOnce(async () => {
      throw new Error("stream failure");
    });

    const req = createSseRequest();
    const res = createSseResponse();

    const streamPromise = handler(req, res);

    await new Promise<void>((resolve) => res.on("finish", resolve));
    await streamPromise;

    const events = parseSseEvents(res);
    const runError = events.find((evt) => evt.type === EventType.RUN_ERROR);
    expect(runError).toBeDefined();
    expect(runError?.code).toBe("AGENT_ERROR");
    expect(mockedToolsModule.executeToolCallsWithEvents).not.toHaveBeenCalled();
    expect(mockedVerificationFlowModule.performSecondCompletion).not.toHaveBeenCalled();
    expect(mockedVerificationFlowModule.finalizeVerifications).not.toHaveBeenCalled();
  });

  it("proxies streaming chat completions, passes through the SSE body, and persists hashes", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: one\n\n"));
        controller.enqueue(encoder.encode("data: two\n\n"));
        controller.close();
      },
    });
    mockNearAIClient.chatCompletionsStream.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );

    const requestBody = {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      verificationId: "chat-ver",
      verificationNonce: "nonce",
    };

    const req = new PassThrough() as unknown as NextApiRequest;
    req.method = "POST";
    req.body = requestBody;
    req.headers = {};
    req.socket = { remoteAddress: "127.0.0.1" } as any;

    const res = new PassThrough() as unknown as NextApiResponse & {
      headers: Record<string, string>;
      body: string;
    };
    res.headers = {};
    res.body = "";
    res.statusCode = 0;
    res.setHeader = ((key: string, value: string | number | readonly string[]) => {
      res.headers[key] = String(value);
      return res;
    }) as typeof res.setHeader;
    res.status = ((code: number) => {
      res.statusCode = code;
      return res;
    }) as typeof res.status;
    res.json = (payload: unknown) => {
      res.body = JSON.stringify(payload);
      return res;
    };
    const originalWrite = (res.write.bind(res) as unknown) as (
      chunk: any,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      cb?: (error?: Error | null) => void
    ) => boolean;
    res.write = ((chunk: any, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk as Buffer | Uint8Array).toString("utf8");
      res.body += text;
      if (typeof encoding === "function") {
        return originalWrite(chunk, encoding);
      }
      const actualEncoding =
        typeof encoding === "string" ? (encoding as BufferEncoding) : undefined;
      return originalWrite(chunk, actualEncoding, cb);
    }) as typeof res.write;

    res.end = ((chunk?: any, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: () => void) => {
      if (chunk !== undefined) {
        if (typeof encoding === "function") {
          res.write(chunk, encoding);
        } else {
        const actualEncoding =
          typeof encoding === "string" ? (encoding as BufferEncoding) : undefined;
        if (actualEncoding) {
          res.write(chunk, actualEncoding);
        } else {
          res.write(chunk);
        }
        }
      }
      if (cb) cb();
      return res;
    }) as typeof res.end;

    const registerSpy = vi.spyOn(verificationServer, "registerVerificationSession");
    await chatHandler(req as any, res as any);

    expect(res.body).toContain("data: one");
    expect(registerSpy).toHaveBeenCalled();
    registerSpy.mockRestore();
  });
});
