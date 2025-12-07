"use client";

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

type ApiState = {
  loading: boolean;
  error?: string;
  data?: unknown;
  url?: string;
};

const fetchJson = async (path: string) => {
  const response = await fetch(path);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: string; message?: string }).error ??
          (payload as { error?: string; message?: string }).message
        : undefined;
    throw new Error(message ?? `Request failed (${response.status})`);
  }
  return payload;
};

const JsonViewer = ({ value }: { value?: unknown }) => {
  if (!value) {
    return (
      <p className="text-sm text-muted-foreground">
        No result yet. Run the query to view a response.
      </p>
    );
  }
  return (
    <pre className="mt-4 max-h-72 overflow-auto rounded border border-border bg-muted p-3 text-xs text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
};

const SectionWrapper = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <section className="rounded-lg border border-border bg-background-secondary/80 p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
    {children}
  </section>
);

const InputRow = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1 text-sm text-foreground">
    <span className="font-medium text-foreground/70">{label}</span>
    {children}
  </label>
);

export default function DiscourseTestPage() {
  const [latestState, setLatestState] = useState<ApiState>({ loading: false });
  const [latestPerPage, setLatestPerPage] = useState("5");
  const [latestPage, setLatestPage] = useState("0");
  const [latestOrder, setLatestOrder] = useState("default");
  const [latestCategoryId, setLatestCategoryId] = useState("");

  const [searchState, setSearchState] = useState<ApiState>({ loading: false });
  const [searchQuery, setSearchQuery] = useState("near governance");
  const [searchLimit, setSearchLimit] = useState("5");
  const [searchPage, setSearchPage] = useState("1");
  const [searchUserApiKey, setSearchUserApiKey] = useState("");

  const [topicState, setTopicState] = useState<ApiState>({ loading: false });
  const [topicId, setTopicId] = useState("1");

  const [postState, setPostState] = useState<ApiState>({ loading: false });
  const [postId, setPostId] = useState("1");
  const [postIncludeRaw, setPostIncludeRaw] = useState(false);

  const [repliesState, setRepliesState] = useState<ApiState>({ loading: false });
  const [repliesId, setRepliesId] = useState("1");

  const [categoriesState, setCategoriesState] = useState<ApiState>({ loading: false });
  const [categoryDetailState, setCategoryDetailState] =
    useState<ApiState>({ loading: false });
  const [categoryKey, setCategoryKey] = useState("");

  const [tagsState, setTagsState] = useState<ApiState>({ loading: false });
  const [userState, setUserState] = useState<ApiState>({ loading: false });
  const [username, setUsername] = useState("gov-team");

  const handleLatest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (latestPerPage) params.set("per_page", latestPerPage);
    if (latestPage) params.set("page", latestPage);
    if (latestOrder) params.set("order", latestOrder);
    if (latestCategoryId) params.set("category_id", latestCategoryId);
    const url = `/api/discourse/latest?${params.toString()}`;
    setLatestState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setLatestState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setLatestState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams({
      q: searchQuery,
      limit: searchLimit,
      page: searchPage,
    });
    if (searchUserApiKey) {
      params.set("userApiKey", searchUserApiKey);
    }
    const url = `/api/discourse/search?${params.toString()}`;
    setSearchState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setSearchState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setSearchState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handleTopic = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!topicId.trim()) {
      setTopicState({
        loading: false,
        error: "Topic ID is required",
      });
      return;
    }
    const url = `/api/discourse/topics/${encodeURIComponent(topicId)}`;
    setTopicState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setTopicState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setTopicState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handlePost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!postId.trim()) {
      setPostState({ loading: false, error: "Post ID is required" });
      return;
    }
    const params = new URLSearchParams();
    if (postIncludeRaw) params.set("include_raw", "true");
    const url = `/api/discourse/posts/${encodeURIComponent(postId)}?${params.toString()}`;
    setPostState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setPostState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setPostState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handleReplies = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repliesId.trim()) {
      setRepliesState({ loading: false, error: "Post ID is required" });
      return;
    }
    const url = `/api/discourse/posts/${encodeURIComponent(repliesId)}/replies`;
    setRepliesState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setRepliesState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setRepliesState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handleCategories = async () => {
    const url = `/api/discourse/categories`;
    setCategoriesState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setCategoriesState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setCategoriesState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handleCategoryDetail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryKey.trim()) {
      setCategoryDetailState({
        loading: false,
        error: "Category id or slug is required",
      });
      return;
    }
    const url = `/api/discourse/categories/${encodeURIComponent(categoryKey)}`;
    setCategoryDetailState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setCategoryDetailState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setCategoryDetailState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handleTags = async () => {
    const url = `/api/discourse/tags`;
    setTagsState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setTagsState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setTagsState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handleUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim()) {
      setUserState({ loading: false, error: "Username is required" });
      return;
    }
    const url = `/api/discourse/user/${encodeURIComponent(username)}`;
    setUserState({ loading: true, url });
    try {
      const data = await fetchJson(url);
      setUserState({ loading: false, data: data ?? null, url });
    } catch (error) {
      setUserState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const renderState = (state: ApiState) => (
    <div className="mt-3 space-y-2 text-sm">
      <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {state.url ? state.url : "No request yet"}
      </p>
      {state.loading && (
        <p className="text-foreground">Loading…</p>
      )}
      {state.error && (
        <p className="text-sm text-destructive">Error: {state.error}</p>
      )}
      {!state.loading && !state.error && <JsonViewer value={state.data} />}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-12 pt-10 sm:px-6">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Discourse Plugin Sandbox
          </p>
          <h1 className="text-3xl font-bold text-foreground">Plugin smoke test</h1>
          <p className="text-base text-muted-foreground">
            Trigger the hosted Discourse plugin endpoints and inspect their JSON responses.
          </p>
        </header>

        <SectionWrapper title="Latest topics" description="List the freshest discussions via /api/discourse/latest.">
          <form className="grid gap-3 md:grid-cols-4" onSubmit={handleLatest}>
            <InputRow label="per_page">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={latestPerPage}
                onChange={(event) => setLatestPerPage(event.target.value)}
              />
            </InputRow>
            <InputRow label="page">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={latestPage}
                onChange={(event) => setLatestPage(event.target.value)}
              />
            </InputRow>
            <InputRow label="order">
              <select
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={latestOrder}
                onChange={(event) => setLatestOrder(event.target.value)}
              >
                <option value="default">default</option>
                <option value="created">created</option>
                <option value="activity">activity</option>
                <option value="views">views</option>
                <option value="posts">posts</option>
                <option value="likes">likes</option>
              </select>
            </InputRow>
            <InputRow label="category_id">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                placeholder="optional"
                value={latestCategoryId}
                onChange={(event) => setLatestCategoryId(event.target.value)}
              />
            </InputRow>
            <div className="md:col-span-4">
              <button
                type="submit"
                className="mt-2 inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                disabled={latestState.loading}
              >
                Run latest topics
              </button>
            </div>
          </form>
          {renderState(latestState)}
        </SectionWrapper>

        <SectionWrapper title="Search" description="Use /api/discourse/search with query, paging, and optional userApiKey.">
          <form className="grid gap-3 md:grid-cols-5" onSubmit={handleSearch}>
            <InputRow label="query">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </InputRow>
            <InputRow label="limit">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={searchLimit}
                onChange={(event) => setSearchLimit(event.target.value)}
              />
            </InputRow>
            <InputRow label="page">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={searchPage}
                onChange={(event) => setSearchPage(event.target.value)}
              />
            </InputRow>
            <InputRow label="userApiKey">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={searchUserApiKey}
                onChange={(event) => setSearchUserApiKey(event.target.value)}
                placeholder="optional token"
              />
            </InputRow>
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                disabled={searchState.loading}
              >
                Run search
              </button>
            </div>
          </form>
          {renderState(searchState)}
        </SectionWrapper>

        <SectionWrapper title="Topic detail">
          <form className="grid gap-3 md:grid-cols-3" onSubmit={handleTopic}>
            <InputRow label="topic id">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={topicId}
                onChange={(event) => setTopicId(event.target.value)}
              />
            </InputRow>
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                disabled={topicState.loading}
              >
                Fetch topic
              </button>
            </div>
          </form>
          {renderState(topicState)}
        </SectionWrapper>

        <SectionWrapper title="Post detail">
          <form className="grid gap-3 md:grid-cols-4" onSubmit={handlePost}>
            <InputRow label="post id">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={postId}
                onChange={(event) => setPostId(event.target.value)}
              />
            </InputRow>
            <InputRow label="include_raw">
              <input
                type="checkbox"
                checked={postIncludeRaw}
                onChange={(event) => setPostIncludeRaw(event.target.checked)}
              />
            </InputRow>
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                disabled={postState.loading}
              >
                Fetch post
              </button>
            </div>
          </form>
          {renderState(postState)}
        </SectionWrapper>

        <SectionWrapper title="Replies">
          <form className="grid gap-3 md:grid-cols-3" onSubmit={handleReplies}>
            <InputRow label="post id">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={repliesId}
                onChange={(event) => setRepliesId(event.target.value)}
              />
            </InputRow>
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                disabled={repliesState.loading}
              >
                Fetch replies
              </button>
            </div>
          </form>
          {renderState(repliesState)}
        </SectionWrapper>

        <SectionWrapper title="Categories">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
              onClick={handleCategories}
              disabled={categoriesState.loading}
            >
              Fetch categories
            </button>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleCategoryDetail}>
              <InputRow label="id or slug">
                <input
                  className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                  value={categoryKey}
                  onChange={(event) => setCategoryKey(event.target.value)}
                />
              </InputRow>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded bg-secondary px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary/80"
                disabled={categoryDetailState.loading}
              >
                Fetch category
              </button>
            </form>
          </div>
          {renderState(categoriesState)}
          {renderState(categoryDetailState)}
        </SectionWrapper>

        <SectionWrapper title="Tags">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            onClick={handleTags}
            disabled={tagsState.loading}
          >
            Fetch tags
          </button>
          {renderState(tagsState)}
        </SectionWrapper>

        <SectionWrapper title="User profile">
          <form className="grid gap-3 md:grid-cols-4" onSubmit={handleUser}>
            <InputRow label="username">
              <input
                className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </InputRow>
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                disabled={userState.loading}
              >
                Fetch user
              </button>
            </div>
          </form>
          {renderState(userState)}
        </SectionWrapper>
      </div>
    </div>
  );
}
