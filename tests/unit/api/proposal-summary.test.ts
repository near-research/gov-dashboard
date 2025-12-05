import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "@/pages/api/proposals/[id]/summarize";
import { rateLimitConfig } from "@/config/rateLimit";
import { prefetchVerificationProof } from "@/server/prefetchVerificationProof";
import { proposalCache, CacheKeys } from "@/utils/cache-utils";

const mockChatCompletions = vi.fn();
vi.mock("@/lib/near-ai/client", () => ({
  getNearAIClient: () => ({
    chatCompletions: mockChatCompletions,
  }),
}));

vi.mock("@/server/prefetchVerificationProof", () => ({
  prefetchVerificationProof: vi.fn(),
}));

vi.mock("@/server/attestation-cache", () => {
  const expectations = {
    arch: "HOPPER",
    deviceCertHash: "device-hash",
    rimHash: "rim",
    ueid: "ueid",
    measurements: ["measurement"],
  };
  return {
    getModelExpectations: vi.fn().mockResolvedValue(expectations),
  };
});

const topicPayload = {
  title: "AI proposal",
  category_id: 7,
  post_stream: {
    posts: [
      {
        id: 101,
        username: "alice",
        cooked: "<p>Proposal body</p>",
        created_at: "2025-01-01T00:00:00Z",
        like_count: 12,
      },
    ],
  },
  views: 42,
  posts_count: 5,
};

const rawContent =
  "alice | 2025-01-01 00:00:00 UTC | #1\n\n# Proposal markdown\n\nMore text";

const createRequest = (): NextApiRequest =>
  ({
    method: "POST",
    query: { id: "101" },
    headers: {
      host: "example.org",
      origin: "https://dashboard.example",
      "x-forwarded-for": "203.0.113.5",
    },
    socket: { remoteAddress: "127.0.0.1" } as any,
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
    send(payload: unknown) {
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

const prefetchMock = vi.mocked(prefetchVerificationProof);

describe("proposal summary API", () => {
  const originalFetch = globalThis.fetch;

  const stubDiscourseFetch = () =>
    ((globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
          ? input.url
          : input.href;

      if (url.includes("/t/") && url.endsWith(".json")) {
        return {
          ok: true,
          json: async () => topicPayload,
        } as unknown as Response;
      }

      if (url.includes("/raw/")) {
        return {
          ok: true,
          text: async () => rawContent,
        } as unknown as Response;
      }

      return {
        ok: true,
        text: async () => "",
      } as unknown as Response;
    })) as typeof globalThis.fetch);

  beforeEach(() => {
    proposalCache.clear();
    mockChatCompletions.mockReset();
    prefetchMock.mockReset();
    stubDiscourseFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a summary, emits rate-limit headers, caches results, and merges remote proof", async () => {
    mockChatCompletions.mockResolvedValue({
      id: "near-summary",
      choices: [{ message: { content: "Executive summary" } }],
      verification: { status: "pending" },
    });

    const remoteProof = {
      results: { verified: true, reasons: [] },
    };
    prefetchMock.mockResolvedValue(remoteProof as any);

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    const body = res.getBody() as any;

    expect(res.getStatusCode()).toBe(200);
    expect(body.cached).toBe(false);
    expect(body.summary).toBe("Executive summary");
    expect(body.verification?.status).toBe("verified");
    expect(body.remoteProof).toBe(remoteProof);
    expect(res.headers["X-RateLimit-Limit"]).toBe(
      rateLimitConfig.proposalSummary.maxRequests.toString()
    );
    expect(res.headers["X-RateLimit-Remaining"]).toBeDefined();
    expect(res.headers["X-RateLimit-Reset"]).toBeDefined();
    const prefetchArgs = prefetchMock.mock.calls[0];
    expect(prefetchArgs[0]).toBe("https://dashboard.example");
    expect(prefetchArgs[1]).toEqual(
      expect.objectContaining({
        verificationId: body.verificationId,
        requestHash: body.proof.requestHash,
        responseHash: body.proof.responseHash,
      })
    );
    const cacheKey = CacheKeys.proposal("101");
    expect(proposalCache.has(cacheKey)).toBe(true);

    const secondReq = createRequest();
    const secondRes = createResponse();

    await handler(secondReq, secondRes);

    const cachedBody = secondRes.getBody() as any;
    expect(cachedBody.cached).toBe(true);
    expect(cachedBody.cacheAge).toBeGreaterThanOrEqual(0);
    expect(prefetchMock).toHaveBeenCalledTimes(1);
  });

  it("still succeeds when remote-proof lookup resolves to null", async () => {
    mockChatCompletions.mockResolvedValue({
      id: "near-summary",
      choices: [{ message: { content: "Executive summary" } }],
      verification: { status: "pending" },
    });
    prefetchMock.mockResolvedValue(null);

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    const body = res.getBody() as any;
    expect(res.getStatusCode()).toBe(200);
    expect(body.remoteProof).toBeUndefined();
    expect(body.verification?.status).toBe("pending");
  });
});
