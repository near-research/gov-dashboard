import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "@/pages/api/discourse/topics/[id]/summarize";
import { rateLimitConfig } from "@/config/rateLimit";
import { prefetchVerificationProof } from "@/server/prefetchVerificationProof";
import { discussionCache, CacheKeys } from "@/utils/cache-utils";

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

const discussionPayload = {
  title: "NEAR discussion",
  participant_count: 4,
  post_stream: {
    posts: [
      {
        id: 1,
        post_number: 1,
        username: "alice",
        cooked: "<p>Original post</p>",
      },
      {
        id: 2,
        post_number: 2,
        username: "bob",
        cooked: "<p>Reply content</p>",
        reply_to_post_number: 1,
        reply_to_user: { username: "alice" },
        actions_summary: [{ id: 2, count: 3 }],
      },
    ],
  },
};

const createRequest = (): NextApiRequest =>
  ({
    method: "POST",
    query: { id: "222" },
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

describe("discussion summary API", () => {
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
          json: async () => discussionPayload,
        } as unknown as Response;
      }

      return {
        ok: true,
        text: async () => "",
      } as unknown as Response;
    })) as typeof globalThis.fetch);

  beforeEach(() => {
    discussionCache.clear();
    mockChatCompletions.mockReset();
    prefetchMock.mockReset();
    stubDiscourseFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a discussion summary with rate-limit headers, caches results, and merges remote proof", async () => {
    mockChatCompletions.mockResolvedValue({
      id: "discussion-summary",
      choices: [{ message: { content: "Community summary" } }],
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
    expect(body.summary).toBe("Community summary");
    expect(body.cached).toBe(false);
    expect(body.verification?.status).toBe("verified");
    expect(body.remoteProof).toBe(remoteProof);
    expect(body.engagement.totalLikes).toBe(3);
    expect(body.engagement.highlyEngagedReplies).toBe(0);
    expect(res.headers["X-RateLimit-Limit"]).toBe(
      rateLimitConfig.discussionSummary.maxRequests.toString()
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

    const cacheKey = CacheKeys.discussion("222");
    expect(discussionCache.has(cacheKey)).toBe(true);

    const secondReq = createRequest();
    const secondRes = createResponse();

    await handler(secondReq, secondRes);

    const cached = secondRes.getBody() as any;
    expect(cached.cached).toBe(true);
    expect(cached.cacheAge).toBeGreaterThanOrEqual(0);
    expect(prefetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps working when remote-proof prefetch returns null", async () => {
    mockChatCompletions.mockResolvedValue({
      id: "discussion-summary",
      choices: [{ message: { content: "Community summary" } }],
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
