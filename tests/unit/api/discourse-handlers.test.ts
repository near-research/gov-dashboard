import latestHandler from "@/pages/api/discourse/latest";
import searchHandler from "@/pages/api/discourse/search";
import { DISCOURSE_RENDER_LIMIT } from "@/config/discourse";
import {
  discourseLatestTopics,
  discourseSearch,
} from "@/server/plugins/discourse-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "stream";

vi.mock("@/server/plugins/discourse-client", () => ({
  discourseLatestTopics: vi.fn(),
  discourseSearch: vi.fn(),
}));

const createReq = (overrides: Partial<any> = {}) =>
  ({
    method: "GET",
    query: {},
    ...overrides,
  }) as any;

const createRes = () => {
  const headers: Record<string, any> = {};
  const stream = new PassThrough();
  const bodyChunks: Array<Buffer> = [];

  stream.on("data", (chunk) => {
    bodyChunks.push(Buffer.from(chunk));
  });

  const res: any = stream;
  res.headers = headers;
  res.statusCode = 200;
  res.setHeader = (key: string, value: any) => {
    headers[key] = value;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value: any) => {
    res._jsonBody = value;
    return res;
  };
  res.send = (value: any) => {
    res._sentBody = value;
    return res;
  };
  res.getBody = () => {
    if (res._jsonBody !== undefined) return res._jsonBody;
    if (res._sentBody !== undefined) return res._sentBody;
    return Buffer.concat(bodyChunks).toString();
  };

  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("discourse search handler", () => {
  it("returns plugin search results capped for UI", async () => {
    (discourseSearch as any).mockResolvedValue({
      data: {
        posts: Array.from({ length: 25 }).map((_, index) => ({
          id: index + 1,
        })),
      },
    });

    const req = createReq({ query: { q: "governance", limit: "25" } });
    const res = createRes();

    await searchHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.getBody().posts).toHaveLength(DISCOURSE_RENDER_LIMIT);
  });

  it("bubbles up plugin errors with status", async () => {
    (discourseSearch as any).mockResolvedValue({
      error: "Plugin offline",
      status: 502,
    });

    const req = createReq({ query: { q: "test" } });
    const res = createRes();

    await searchHandler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.getBody()).toEqual({ error: "Plugin offline" });
  });

  it("rejects unsupported parameters early", async () => {
    const req = createReq({ query: { q: "test", extra: "1" } });
    const res = createRes();

    await searchHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.getBody().error).toContain("Unsupported parameter(s)");
  });
});

describe("discourse latest handler", () => {
  it("enforces render cap and per-page bounds", async () => {
    (discourseLatestTopics as any).mockResolvedValue({
      data: {
        topics: Array.from({ length: 50 }).map((_, index) => ({
          id: index + 1,
          title: `Topic ${index + 1}`,
          slug: `topic-${index + 1}`,
          categoryId: 1,
          createdAt: "2024-01-01T00:00:00Z",
          lastPostedAt: "2024-01-02T00:00:00Z",
          postsCount: 10,
          replyCount: 9,
          likeCount: 5,
          views: 100,
          pinned: false,
          closed: false,
          archived: false,
          visible: true,
        })),
      },
    });

    const req = createReq({ query: { per_page: "30" } });
    const res = createRes();

    await latestHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.getBody().latest_posts).toHaveLength(DISCOURSE_RENDER_LIMIT);
    expect(res.getBody().per_page).toBe(DISCOURSE_RENDER_LIMIT);
  });
});
