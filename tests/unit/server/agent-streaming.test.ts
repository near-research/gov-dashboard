import { createHash } from "crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { consumeStream } from "@/server/agent/streaming";
import * as verificationServer from "@/verification/server";

const createMockResponse = (chunks: string[]) => {
  let index = 0;
  const reader = {
    read: async () => {
      if (index < chunks.length) {
        const value = new TextEncoder().encode(chunks[index++]);
        return { value, done: false };
      }
      return { value: undefined, done: true };
    },
  };

  return {
    body: {
      getReader: () => reader,
    },
  } as unknown as Response;
};

describe("consumeStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    verificationServer.clearVerificationSession("session-42");
  });

  it("records the SHA-256 hash of the raw SSE payload", async () => {
    const sseChunks = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n",
      "data: {\"choices\":[{\"delta\":{\"finish_reason\":\"stop\"}}]}\n",
      "data: [DONE]\n",
    ];
    const expectedRaw = sseChunks.join("");
    const expectedHash = createHash("sha256").update(expectedRaw).digest("hex");
    const mockResponse = createMockResponse(sseChunks);
    const updateSpy = vi.spyOn(verificationServer, "updateVerificationHashes");
    verificationServer.registerVerificationSession("session-42");

    await consumeStream({
      response: mockResponse,
      writeEvent: vi.fn(),
      sessionVerificationId: "session-42",
    });

    expect(updateSpy).toHaveBeenCalledWith(
      "session-42",
      expect.objectContaining({
        responseHash: expectedHash,
      })
    );
  });
});
