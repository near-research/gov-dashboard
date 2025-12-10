import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "@/pages/api/summarize/test";
import { NearAIError, getNearAIClient } from "@/lib/near-ai";
import type { TextSummaryResponse } from "@/types/summaries";
import type { VerificationProofResponse } from "@/types/verification";
import { prefetchVerificationProof } from "@/server/prefetchVerificationProof";

const mockChatCompletions = vi.fn();
const mockCreateSession = vi.fn((id: string) => ({
  nonce: `mock-nonce-${id}`,
  createdAt: Date.now(),
  expiresAt: Date.now() + 300000,
}));
const mockGetSession = vi.fn((id: string) => ({
  nonce: `mock-nonce-${id}`,
  createdAt: Date.now(),
  expiresAt: Date.now() + 300000,
}));
vi.mock("@/lib/near-ai/client", () => ({
  getNearAIClient: () => ({
    chatCompletions: mockChatCompletions,
    createSession: mockCreateSession,
    getSession: mockGetSession,
    updateSessionHashes: vi.fn(),
    clearSession: vi.fn(),
    verify: vi.fn().mockResolvedValue({
      verified: true,
      reasons: [],
    }),
  }),
}));

vi.mock("@/server/prefetchVerificationProof", () => ({
  prefetchVerificationProof: vi.fn(),
}));
const prefetchMock = vi.mocked(prefetchVerificationProof);

vi.mock("@/server/attestation-cache", () => ({
  getModelExpectations: vi.fn().mockResolvedValue({
    arch: "HOPPER",
    deviceCertHash: "device-hash",
    rimHash: "rim-hash",
    ueid: "ueid",
    measurements: ["measurement"],
  }),
}));

const createRequest = (): NextApiRequest =>
  ({
    method: "POST",
    headers: {
      host: "example.org",
      origin: "https://dashboard.example",
    },
  } as unknown as NextApiRequest);

const createResponse = () => {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;

  const res: any = {
    headers,
    getBody: () => body,
    getStatusCode: () => statusCode,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };

  Object.defineProperty(res, "statusCode", {
    get: () => statusCode,
    set: (value: number) => {
      statusCode = value;
    },
  });

  return res as unknown as NextApiResponse<any> & {
    headers: Record<string, string>;
    getBody: () => unknown;
    getStatusCode: () => number;
  };
};

describe("/api/summarize/test", () => {
  beforeEach(() => {
    mockChatCompletions.mockReset();
    prefetchMock.mockReset();
  });

  it("returns a summary with verification metadata and remote proof", async () => {
    mockChatCompletions.mockResolvedValue({
      id: "chatcmpl-house",
      choices: [
        {
          message: { content: "House of Stake is a NEAR protocol initiative." },
        },
      ],
      verification: { status: "pending", source: "near-ai-cloud" },
    });
    const remoteProof: VerificationProofResponse = {
      results: { verified: true, reasons: [] },
    };
    prefetchMock.mockResolvedValue(remoteProof);

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    const body = res.getBody() as TextSummaryResponse;
    expect(res.getStatusCode()).toBe(200);
    expect(body.summary).toContain("House of Stake");
    expect(body.verificationId).toBeDefined();
    expect(body.proof?.requestHash).toBeDefined();
    expect(prefetchMock).toHaveBeenCalledWith(
      "https://dashboard.example",
      expect.objectContaining({
        verificationId: body.verificationId,
        requestHash: body.proof?.requestHash,
        responseHash: body.proof?.responseHash,
      })
    );
    expect(body.remoteProof).toBe(remoteProof);
    expect(body.verification?.status).toBe("verified");

    if (body.verificationId) {
      getNearAIClient().clearSession(body.verificationId);
    }
  });

  it("propagates NEAR AI error status codes", async () => {
    mockChatCompletions.mockRejectedValue(new NearAIError("Service busy", 503));

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    expect(res.getStatusCode()).toBe(503);
    expect(res.getBody()).toEqual({
      error: "NEAR AI Cloud API Error: 503",
    });
  });
});
