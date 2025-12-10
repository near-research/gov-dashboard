import { describe, it, expect, vi } from "vitest";
import { consumeStream } from "@/server/agent/streaming";
import { createHash } from "crypto";

const updateSessionHashes = vi.fn();
const createSession = vi.fn();

vi.mock("@/lib/near-ai", () => ({
  getNearAIClient: () => ({
    createSession,
    updateSessionHashes,
  }),
}));

describe("consumeStream response hashing", () => {
  it("stores response hash for exact streamed text", async () => {
    const ssePayload =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ssePayload));
        controller.close();
      },
    });
    const response = new Response(stream);

    await consumeStream({
      response,
      writeEvent: vi.fn(),
      sessionVerificationId: "ver-123",
    });

    const expectedHash = createHash("sha256").update(ssePayload).digest("hex");
    expect(createSession).toHaveBeenCalledWith("ver-123");
    expect(updateSessionHashes).toHaveBeenCalledWith("ver-123", {
      requestHash: undefined,
      responseHash: expectedHash,
    });
  });
});
