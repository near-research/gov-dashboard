import { describe, it, expect, vi } from "vitest";
import { consumeStream } from "@/server/agent/streaming";
import { createHash } from "crypto";

var updateVerificationHashes = vi.fn();

vi.mock("@/verification/server", () => ({
  updateVerificationHashes: (...args: any[]) => updateVerificationHashes(...args),
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
    expect(updateVerificationHashes).toHaveBeenCalledWith("ver-123", {
      responseHash: expectedHash,
    });
  });
});
