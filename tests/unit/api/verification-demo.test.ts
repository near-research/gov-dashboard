import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "@/pages/api/summarize/test";
import { NearAIError, getNearAIClient } from "@/lib/near-ai";
import type { TextSummaryResponse } from "@/types/summaries";
import type { VerificationProofResponse } from "@/types/verification";
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
const mockVerify = vi
  .fn()
  .mockResolvedValue({ verified: true, reasons: [] });
vi.mock("@/lib/near-ai/client", () => ({
  getNearAIClient: () => ({
    chatCompletions: mockChatCompletions,
    createSession: mockCreateSession,
    getSession: mockGetSession,
    updateSessionHashes: vi.fn(),
    clearSession: vi.fn(),
    verify: mockVerify,
  }),
}));

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
    mockVerify.mockReset();
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
    const verificationResult: VerificationProofResponse = {
      attestation: { info: "att" } as any,
      signature: { text: "sig" },
      signatureVerification: { verified: true },
      nras: { verified: true, reasons: [] },
      nonceCheck: { valid: true, expected: "mock-nonce" },
      intel: { verified: true },
      attestationNodes: [],
      configMissing: undefined,
      verified: true,
      reasons: [],
      results: { verified: true, reasons: [] },
    };
    mockVerify.mockResolvedValue(verificationResult);

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    const body = res.getBody() as TextSummaryResponse;
    expect(res.getStatusCode()).toBe(200);
    expect(body.summary).toContain("House of Stake");
    expect(body.verificationId).toBeDefined();
    expect(body.proof?.requestHash).toBeDefined();
    expect(mockVerify).toHaveBeenCalledWith({
      verificationId: body.verificationId,
      model: expect.anything(),
      chatId: "chatcmpl-house",
      requestHash: body.proof?.requestHash,
      responseHash: body.proof?.responseHash,
    });
    expect(body.remoteProof?.verified).toBe(true);
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
