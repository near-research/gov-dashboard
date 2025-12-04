import "../../vi-compat";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ORPCError } from "@orpc/server";
import { DISCOURSE_RENDER_LIMIT } from "@/config/discourse";

const mockRouter = {
  search: vi.fn(),
  getLatestTopics: vi.fn(),
  getTopic: vi.fn(),
  getPost: vi.fn(),
  getPostReplies: vi.fn(),
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  getTags: vi.fn(),
};

vi.mock("server-only", () => ({}));

vi.mock("every-plugin", () => ({
  createPluginRuntime: () => ({
    usePlugin: vi.fn().mockResolvedValue({ router: mockRouter }),
  }),
}));

const importClient = async () => {
  vi.resetModules();
  (globalThis as any).__mockDiscourseRouter = mockRouter;
  return await import("@/server/plugins/discourse-client");
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("discourse client", () => {
  it("validates search input before calling plugin", async () => {
    const { discourseSearch } = await importClient();

    const invalid = await discourseSearch({ query: "   " } as any);
    expect(invalid.error).toBeDefined();
    expect(mockRouter.search).not.toHaveBeenCalled();

    mockRouter.search.mockResolvedValueOnce({
      posts: [
        {
          topicTitle: "Hello",
          blurb: "Example",
          id: 1,
          topicId: 42,
          postNumber: 1,
          username: "alice",
          name: null,
          avatarTemplate: "x",
          cooked: "Example",
          createdAt: "2024-01-01",
          updatedAt: null,
          replyCount: 0,
          likeCount: 0,
          replyToPostNumber: null,
          version: 1,
        },
        {
          topicTitle: "Hello 2",
          blurb: "Example 2",
          id: 2,
          topicId: 43,
          postNumber: 1,
          username: "bob",
          name: null,
          avatarTemplate: "x",
          cooked: "Example",
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
          id: 42,
          title: "Hello",
          slug: "hello",
          categoryId: null,
          createdAt: "2024-01-01",
          lastPostedAt: "2024-01-02",
          postsCount: 1,
          replyCount: 0,
          likeCount: 0,
          views: 0,
          pinned: false,
          closed: false,
          archived: false,
          visible: true,
        },
        {
          id: 43,
          title: "Hello 2",
          slug: "hello-2",
          categoryId: null,
          createdAt: "2024-01-01",
          lastPostedAt: "2024-01-02",
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
      totalResults: 2,
      hasMore: false,
      nextPage: null,
    });
    const valid = await discourseSearch({ query: " hello ", page: 2, limit: 1 });
    expect(valid.data?.posts).toHaveLength(1);
    expect(valid.data?.topics).toHaveLength(1);
    expect(mockRouter.search).toHaveBeenCalledWith({ query: "hello", page: 2 });
  });

  it("maps ORPC errors to status codes", async () => {
    const { discoursePost } = await importClient();

    mockRouter.getPost.mockRejectedValueOnce(
      new ORPCError("NOT_FOUND", { message: "missing" })
    );

    const res = await discoursePost({ postId: 5 });
    expect(res.error).toBe("The requested resource was not found.");
    expect(res.status).toBe(404);
  });

  it("validates latest topics responses", async () => {
    const { discourseLatestTopics } = await importClient();

    mockRouter.getLatestTopics.mockResolvedValueOnce({
      topics: [
        {
          id: 1,
          title: "t",
          slug: "s",
          categoryId: null,
          createdAt: null,
          lastPostedAt: null,
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
      hasMore: false,
      nextPage: null,
    });

    const ok = await discourseLatestTopics({ page: 0, order: "default" });
    expect(ok.error).toBeUndefined();
    expect(ok.data?.topics).toHaveLength(1);

    mockRouter.getLatestTopics.mockResolvedValueOnce({ foo: "bar" });
    const bad = await discourseLatestTopics({ page: 0, order: "default" });
    expect(bad.error).toContain("Invalid latest topics response");
  });

  it("validates post and replies payloads", async () => {
    const { discoursePost, discourseReplies } = await importClient();

    mockRouter.getPost.mockResolvedValueOnce({
      post: {
        id: 99,
        topicId: 1,
        postNumber: 1,
        username: "alice",
        name: null,
        avatarTemplate: "x",
        raw: "raw",
        cooked: "cooked",
        createdAt: "2024-01-01",
        updatedAt: null,
        replyCount: 0,
        likeCount: 0,
        replyToPostNumber: null,
        version: 1,
      },
      topic: {
        id: 1,
        title: "Topic",
        slug: "topic",
        categoryId: null,
        createdAt: "2024-01-01",
        lastPostedAt: "2024-01-02",
        postsCount: 1,
        replyCount: 0,
        likeCount: 0,
        views: 0,
        pinned: false,
        closed: false,
        archived: false,
        visible: true,
      },
    });

    const postResult = await discoursePost({ postId: 99, includeRaw: true });
    expect(postResult.error).toBeUndefined();
    expect(postResult.data?.post.raw).toBe("raw");

    mockRouter.getPostReplies.mockResolvedValueOnce({
      replies: [
        {
          id: 100,
          topicId: 1,
          postNumber: 2,
          username: "bob",
          name: null,
          avatarTemplate: "x",
          cooked: "reply",
          createdAt: "2024-01-01",
          updatedAt: null,
          replyCount: 0,
          likeCount: 0,
          replyToPostNumber: 1,
          version: 1,
        },
      ],
    });

    const replies = await discourseReplies({ postId: 99 });
    expect(replies.error).toBeUndefined();
    expect(replies.data?.posts).toHaveLength(1);

    mockRouter.getPostReplies.mockResolvedValueOnce({ foo: "bar" });
    const invalidReplies = await discourseReplies({ postId: 5 });
    expect(invalidReplies.error).toContain("Invalid replies response");
  });

  it("caps renderable collections using shared limits", async () => {
    const { discourseSearch, discourseLatestTopics, discourseReplies } =
      await importClient();

    mockRouter.search.mockResolvedValueOnce({
      posts: Array.from({ length: 50 }).map((_, index) => ({
        topicTitle: `Topic ${index}`,
        blurb: "Example",
        id: index + 1,
        topicId: 42 + index,
        postNumber: 1,
        username: "alice",
        name: null,
        avatarTemplate: "x",
        cooked: "Example",
        createdAt: "2024-01-01",
        updatedAt: null,
        replyCount: 0,
        likeCount: 0,
        replyToPostNumber: null,
        version: 1,
      })),
      topics: Array.from({ length: 50 }).map((_, index) => ({
        id: index + 1,
        title: `Topic ${index}`,
        slug: `topic-${index}`,
        categoryId: null,
        createdAt: null,
        lastPostedAt: null,
        postsCount: 1,
        replyCount: 0,
        likeCount: 0,
        views: 0,
        pinned: false,
        closed: false,
        archived: false,
        visible: true,
      })),
      users: [],
      categories: [],
      totalResults: 50,
      hasMore: true,
      nextPage: 2,
    });

    const searchResult = await discourseSearch({ query: "render", limit: 100 });
    expect(searchResult.data?.posts).toHaveLength(DISCOURSE_RENDER_LIMIT);
    expect(searchResult.data?.topics).toHaveLength(DISCOURSE_RENDER_LIMIT);

    mockRouter.getLatestTopics.mockResolvedValueOnce({
      topics: Array.from({ length: 50 }).map((_, index) => ({
        id: index + 1,
        title: `Topic ${index}`,
        slug: `topic-${index}`,
        categoryId: null,
        createdAt: null,
        lastPostedAt: null,
        postsCount: 1,
        replyCount: 0,
        likeCount: 0,
        views: 0,
        pinned: false,
        closed: false,
        archived: false,
        visible: true,
      })),
      hasMore: true,
      nextPage: 2,
    });

    const latest = await discourseLatestTopics({ page: 0, order: "default" });
    expect(latest.data?.topics).toHaveLength(DISCOURSE_RENDER_LIMIT);

    mockRouter.getPostReplies.mockResolvedValueOnce({
      replies: Array.from({ length: 50 }).map((_, index) => ({
        id: index + 1,
        topicId: 1,
        postNumber: index + 1,
        username: "alice",
        name: null,
        avatarTemplate: "x",
        cooked: "reply",
        createdAt: "2024-01-01",
        updatedAt: null,
        replyCount: 0,
        likeCount: 0,
        replyToPostNumber: null,
        version: 1,
      })),
    });

    const replies = await discourseReplies({ postId: 1 });
    expect(replies.data?.posts).toHaveLength(DISCOURSE_RENDER_LIMIT);
  });

  it("validates categories and tags payloads", async () => {
    const { discourseCategories, discourseTags, discourseCategory } =
      await importClient();

    mockRouter.getCategories.mockResolvedValueOnce({
      categories: [
        {
          id: 1,
          name: "c",
          slug: "c",
          description: null,
          color: "#fff",
          topicCount: 1,
          postCount: 1,
          parentCategoryId: null,
          readRestricted: false,
        },
      ],
    });
    const cats = await discourseCategories();
    expect(cats.data?.categories[0].name).toBe("c");

    mockRouter.getTags.mockResolvedValueOnce({
      tags: [
        {
          id: 1,
          name: "tag",
          topicCount: 1,
          pmTopicCount: 0,
          synonyms: [],
          targetTag: null,
          description: null,
        },
      ],
    });
    const tags = await discourseTags();
    expect(tags.data?.tags[0].name).toBe("tag");

    mockRouter.getCategory.mockResolvedValueOnce({
      category: {
        id: 1,
        name: "c",
        slug: "c",
        description: null,
        color: "#fff",
        topicCount: 1,
        postCount: 1,
        parentCategoryId: null,
        readRestricted: false,
      },
      subcategories: [],
    });
    const category = await discourseCategory({ idOrSlug: 1 });
    expect(category.error).toBeUndefined();
  });
});
