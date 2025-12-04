import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import handler from "@/pages/api/chat/completions";
import * as verificationServer from "@/verification/server";
import { EventEmitter } from "events";

const chatSpy = vi.fn();
const streamSpy = vi.fn();
const registerSpy = vi.spyOn(
  verificationServer,
  "registerVerificationSession"
);

vi.mock("@/lib/near-ai/client", () => ({
  getNearAIClient: () => ({
    chatCompletions: chatSpy,
    chatCompletionsStream: streamSpy,
    getConfig: () => ({ baseUrl: "https://example.com", apiKey: "test" }),
  }),
}));

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
    registerSpy.mockClear();
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

  it("proxies valid non-streaming requests", async () => {
    const reqBody = {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    };
    const req = createRequest(reqBody);
    const res = createResponse();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "abc", choices: [] }),
      headers: new Headers({ "content-type": "application/json" }),
    } as any);

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body?.id).toBe("abc");
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

    const registerSpy = vi.spyOn(
      verificationServer,
      "registerVerificationSession"
    );

    const req = createRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      verificationId: "ver-123",
      verificationNonce: "nonce-xyz",
    });
    const res = createResponse();

    await handler(req as any, res as any);

    expect(res.headers["Content-Type"]).toContain("text/event-stream");
    expect(res.getBody()).toBe("data: one\n\ndata: two\n\n");

    const lastCall = registerSpy.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("ver-123");
    expect(lastCall?.[2]).toMatch(/^[0-9a-f]{64}$/); // request hash
    expect(lastCall?.[3]).toMatch(/^[0-9a-f]{64}$/); // response hash
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
      verificationId: "ver-flush",
      verificationNonce: "a".repeat(64),
    });
    const res = createResponse();

    await handler(req as any, res as any);

    const lastCall = registerSpy.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("ver-flush");

    const expectedHash = createHash("sha256")
      .update(Uint8Array.from([0xe2]))
      .update("�")
      .digest("hex");

    expect(lastCall?.[3]).toBe(expectedHash);
  });
});
