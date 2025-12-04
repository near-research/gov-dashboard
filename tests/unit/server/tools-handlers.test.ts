import "../../vi-compat";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import * as discourseClient from "@/server/plugins/discourse-client";

let mockDiscourseSearch: ReturnType<typeof vi.fn>;
let mockDiscourseLatestTopics: ReturnType<typeof vi.fn>;
let mockDiscourseTopic: ReturnType<typeof vi.fn>;
let mockDiscourseReplies: ReturnType<typeof vi.fn>;

import {
  handleSearchDiscourse,
  handleGetLatestTopics,
  handleGetDiscourseTopic,
  handleSummarizeDiscussion,
  handleSummarizeReply,
} from "@/server/tools/discourse";
import { handleGetDoc, DOC_PATHS } from "@/server/tools/docs";

const runtimeBaseUrl = "https://example.com";

describe("server tools handlers", () => {
  beforeEach(() => {
    mockDiscourseSearch = vi.spyOn(discourseClient, "discourseSearch").mockResolvedValue({} as any);
    mockDiscourseLatestTopics = vi
      .spyOn(discourseClient, "discourseLatestTopics")
      .mockResolvedValue({} as any);
    mockDiscourseTopic = vi
      .spyOn(discourseClient, "discourseTopic")
      .mockResolvedValue({} as any);
    mockDiscourseReplies = vi
      .spyOn(discourseClient, "discourseReplies")
      .mockResolvedValue({} as any);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterAll(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("discourse handlers", () => {
    it("returns error when search query missing", async () => {
      const { result } = await handleSearchDiscourse({ query: "   " });
      expect(result).toEqual({ error: "Search query is required" });
    });

    it("rejects unsupported search params", async () => {
      const { result } = await handleSearchDiscourse({
        query: "hello",
        // @ts-expect-error unsupported
        foo: "bar",
      });
      expect(result).toEqual({ error: "Unsupported parameter(s): foo" });
    });

    it("returns error when search API fails", async () => {
      mockDiscourseSearch.mockResolvedValueOnce({
        error: "Search failed",
        status: 500,
      });

      const { result } = await handleSearchDiscourse({ query: "failure" });
      expect(result).toEqual({ error: "Search failed" });
    });

    it("searches discourse and bounds limit", async () => {
      const posts = Array.from({ length: 25 }).map((_, idx) => ({
        topicTitle: `Hello World ${idx + 1}`,
        blurb: "<p>hi there</p>",
        id: idx + 1,
        topicId: 42 + idx,
        postNumber: 1,
        username: "alice",
        name: null,
        avatarTemplate: "x",
        cooked: "<p>hi there</p>",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
        replyCount: 0,
        likeCount: 0,
        replyToPostNumber: null,
        version: 1,
      }));

      mockDiscourseSearch.mockResolvedValue({
        data: {
          posts,
          topics: posts.map((post) => ({
            id: post.topicId,
            title: post.topicTitle,
            slug: "hello",
            categoryId: null,
            createdAt: "2024-01-01",
            lastPostedAt: "2024-01-02",
            postsCount: 3,
            replyCount: 0,
            likeCount: 0,
            views: 10,
            pinned: false,
            closed: false,
            archived: false,
            visible: true,
            excerpt: "<p>Example</p>",
          })),
          users: [],
          categories: [],
          totalResults: 11,
          hasMore: false,
          nextPage: null,
        },
      });

      const { result } = await handleSearchDiscourse({
        query: "hello",
        limit: 30, // should clamp to 20 render limit
        before: "2024-01-01",
        after: "2024-02-01",
        username: "alice",
        tags: ["tag1", "tag2"],
        order: "latest",
        status: "open",
        in: "title",
        page: 2,
      });

      expect(mockDiscourseSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "hello",
          limit: 30,
          before: "2024-01-01",
          after: "2024-02-01",
          username: "alice",
          order: "latest",
          status: "open",
          in: "title",
          page: 2,
          tags: ["tag1", "tag2"],
          category: expect.any(String),
          userApiKey: undefined,
        })
      );
      expect((result as any).type).toBe("proposal_list");
      expect((result as any).topics).toHaveLength(20);
      expect((result as any).total_count).toBe(11);
    });

    it("returns validation error for invalid search limit and strips HTML from excerpts", async () => {
      mockDiscourseSearch.mockResolvedValueOnce({
        data: {
          posts: [
            {
              topicTitle: "Proposal 55",
              blurb: "<p>Hello <strong>world</strong></p>",
              id: 5,
              topicId: 55,
              postNumber: 1,
              username: "bob",
              name: null,
              avatarTemplate: "x",
              cooked: "<p>Hello <strong>world</strong></p>",
              createdAt: "2024-01-01",
              updatedAt: null,
              replyCount: 0,
              likeCount: 0,
              replyToPostNumber: null,
              version: 1,
            },
          ],
          topics: [
            {
              id: 55,
              title: "Proposal 55",
              slug: "proposal-55",
              categoryId: null,
              createdAt: "2024-01-01",
              lastPostedAt: "2024-01-01",
              postsCount: 1,
              replyCount: 0,
              likeCount: 0,
              views: 0,
              pinned: false,
              closed: false,
              archived: false,
              visible: true,
            },
          ],
          users: [],
          categories: [],
          totalResults: 1,
          hasMore: false,
          nextPage: null,
        },
      });

      const { result } = await handleSearchDiscourse({
        query: "html",
      });

      expect((result as any).topics[0].excerpt).toBe("Hello world");
      expect((result as any).description).toContain('Top 1 search results for "html"');

      const badLimit = await handleSearchDiscourse({
        query: "html",
        limit: -1 as unknown as number,
      });
      expect((badLimit.result as any).error).toContain("greater than or equal to 1");
    });

    it("fetches latest topics and handles API errors", async () => {
      mockDiscourseLatestTopics.mockResolvedValueOnce({
        data: {
          topics: [
            {
              id: 99,
              slug: "latest-slug",
              title: "Latest title",
              excerpt: "summary",
              username: "bob",
              postsCount: 4,
              replyCount: 2,
              views: 7,
              likeCount: 1,
              createdAt: "2024-02-01",
              lastPostedAt: "2024-02-02",
              categoryId: null,
              pinned: false,
              closed: false,
              archived: false,
              visible: true,
            },
          ],
          hasMore: false,
          nextPage: null,
        },
      });

      const success = await handleGetLatestTopics({ limit: 5 }, runtimeBaseUrl);
      expect((success.result as any).topics).toHaveLength(1);
      expect((success.result as any).topics[0].title).toBe("Latest title");

      mockDiscourseLatestTopics.mockResolvedValueOnce({
        error: "network",
      });
      const failure = await handleGetLatestTopics({ limit: 5 }, runtimeBaseUrl);
      expect((failure.result as any).error).toBe("network");

      const unsupported = await handleGetLatestTopics(
        // @ts-expect-error unsupported param
        { limit: 5, extra: true },
        runtimeBaseUrl
      );
      expect(unsupported.result).toEqual({
        error: "Unsupported parameter(s): extra",
      });

      mockDiscourseLatestTopics.mockResolvedValueOnce({
        data: {
          topics: Array.from({ length: 25 }).map((_, idx) => ({
            id: idx + 1,
            slug: `slug-${idx + 1}`,
            title: `Title ${idx + 1}`,
            excerpt: "summary",
            username: "bob",
            postsCount: 4,
            replyCount: 2,
            views: 7,
            likeCount: 1,
            createdAt: "2024-02-01",
            lastPostedAt: "2024-02-02",
            categoryId: null,
            pinned: false,
            closed: false,
            archived: false,
            visible: true,
          })),
          hasMore: true,
          nextPage: 2,
        },
      });
      const capped = await handleGetLatestTopics({ limit: 30 }, runtimeBaseUrl);
      expect((capped.result as any).topics).toHaveLength(20);
    });

    it("fetches topic detail and caps posts at 20", async () => {
      const posts = Array.from({ length: 25 }).map((_, idx) => ({
        id: idx + 1,
        postNumber: idx + 1,
        username: `user${idx + 1}`,
        cooked: `<p>post ${idx + 1}</p>`,
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
        replyCount: 0,
        likeCount: 3,
        replyToPostNumber: null,
        version: 1,
        topicId: 99,
        name: null,
        avatarTemplate: "x",
      }));

      mockDiscourseTopic.mockResolvedValueOnce({
        data: {
          topic: {
            id: 99,
            title: "Topic",
            slug: "topic-slug",
            postsCount: 25,
            views: 100,
            likeCount: 7,
            replyCount: 3,
            categoryId: null,
            createdAt: "2024-01-01",
            lastPostedAt: "2024-01-02",
            pinned: false,
            closed: false,
            archived: false,
            visible: true,
          },
          posts,
        },
      });

      const { result } = await handleGetDiscourseTopic({ topic_id: "99" });
      expect((result as any).posts).toHaveLength(20);
      expect((result as any).posts[0].content).toBe("post 1");
      expect((result as any).url).toContain("/t/topic-slug/99");

      mockDiscourseTopic.mockResolvedValueOnce({
        error: "Failed",
      });
      const errorResult = await handleGetDiscourseTopic({ topic_id: "404" });
      expect((errorResult.result as any).error).toBe(
        "Failed"
      );
    });

    it("summarizes discussion and reply via runtime API", async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          title: "Example",
          summary: "Summary text",
          replyCount: 12,
          engagement: { score: 0.8 },
        }),
      });

      const discussion = await handleSummarizeDiscussion(
        { topic_id: "123" },
        runtimeBaseUrl
      );
      expect((discussion.result as any).url).toContain("/t/123");
      expect((fetch as any).mock.calls[0][0]).toContain(
        "/api/discourse/topics/123/summarize"
      );

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          author: "alice",
          postNumber: 2,
          summary: "Reply summary",
          likeCount: 5,
          replyTo: null,
        }),
      });

      const reply = await handleSummarizeReply(
        { post_id: "55" },
        runtimeBaseUrl
      );
      expect((reply.result as any).post_number).toBe(2);
      expect((fetch as any).mock.calls[1][0]).toContain(
        "/api/discourse/replies/55/summarize"
      );

      (fetch as any).mockRejectedValueOnce(new Error("boom"));
      const replyError = await handleSummarizeReply(
        { post_id: "bad" },
        runtimeBaseUrl
      );
      expect((replyError.result as any).error).toBe("boom");
    });
  });

  describe("docs handlers", () => {
    it("returns error for unknown doc_key", async () => {
      const { result } = await handleGetDoc({ doc_key: "missing" as any });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown doc_key/);
    });

    it("fetches known doc content", async () => {
      const firstKey = Object.keys(DOC_PATHS)[0] as keyof typeof DOC_PATHS;

      (fetch as any).mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue("<h1>Title</h1><p>Body</p>"),
      });

      const { result } = await handleGetDoc({ doc_key: firstKey });
      expect(result.success).toBe(true);
      expect(result.content).toContain("Title");
      expect(result.cached).toBeFalsy();
    });
  });

});
