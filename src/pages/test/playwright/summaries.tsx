"use client";

import { useState } from "react";
import Head from "next/head";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { DiscussionSummaryResponse, ReplySummaryResponse } from "@/components/proposal/types/summaries";

const fetchJson = async <T,>(path: string, body?: Record<string, unknown>): Promise<T> => {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error("Failed to load summary");
  }
  return response.json();
};

export default function PlaywrightSummariesPage() {
  const [topicId, setTopicId] = useState("1234");
  const [replyId, setReplyId] = useState("5678");
  const [discussion, setDiscussion] = useState<DiscussionSummaryResponse | null>(null);
  const [replySummary, setReplySummary] = useState<ReplySummaryResponse | null>(null);
  const [discussionLoading, setDiscussionLoading] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [discussionError, setDiscussionError] = useState("");
  const [replyError, setReplyError] = useState("");

  const handleDiscussion = async () => {
    setDiscussionLoading(true);
    setDiscussionError(" ");
    try {
      const data = await fetchJson<DiscussionSummaryResponse>(
        `/api/discourse/topics/${encodeURIComponent(topicId)}/summarize`
      );
      setDiscussion(data);
    } catch (error: unknown) {
      setDiscussionError(
        error instanceof Error ? error.message : "Failed to load discussion"
      );
    } finally {
      setDiscussionLoading(false);
    }
  };

  const handleReply = async () => {
    setReplyLoading(true);
    setReplyError(" ");
    try {
      const data = await fetchJson<ReplySummaryResponse>(
        `/api/discourse/replies/${encodeURIComponent(replyId)}/summarize`
      );
      setReplySummary(data);
    } catch (error: unknown) {
      setReplyError(
        error instanceof Error ? error.message : "Failed to load reply summary"
      );
    } finally {
      setReplyLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Playwright Summaries Fixture</title>
      </Head>
      <main className="min-h-screen bg-background py-12 px-4">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              Testing Harness
            </p>
            <h1 className="text-3xl font-bold">Forum Summaries</h1>
            <p className="text-sm text-muted-foreground">
              Trigger NEAR AI discussion and reply summaries without hitting production services.
            </p>
          </div>

          <section className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Summarize Discussion</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3">
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <label htmlFor="topic-id" className="font-semibold">
                      Topic ID
                    </label>
                    <Input
                      id="topic-id"
                      value={topicId}
                      onChange={(event) => setTopicId(event.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleDiscussion}
                    disabled={discussionLoading || !topicId.trim()}
                  >
                    {discussionLoading ? "Summarizing…" : "Summarize Discussion"}
                  </Button>
                </div>
                {discussion && (
                  <div data-testid="discussion-summary-result" className="space-y-1 text-sm">
                    <p className="text-muted-foreground">Model: {discussion.model}</p>
                    <Textarea readOnly value={discussion.summary} className="h-32" />
                    <p className="text-xs text-muted-foreground">
                      Replies: {discussion.replyCount} • Generated at {new Date(discussion.generatedAt * 1000).toLocaleString()}
                    </p>
                  </div>
                )}
                {discussionError && (
                  <p className="text-xs text-destructive">{discussionError}</p>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Summarize Reply</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1 text-sm text-muted-foreground">
                  <label htmlFor="reply-id" className="font-semibold">
                    Reply ID
                  </label>
                  <Input id="reply-id" value={replyId} onChange={(event) => setReplyId(event.target.value)} />
                </div>
                <Button
                  onClick={handleReply}
                  disabled={replyLoading || !replyId.trim()}
                >
                  {replyLoading ? "Summarizing…" : "Summarize Reply"}
                </Button>
                {replySummary && (
                  <div data-testid="reply-summary-result" className="space-y-1 text-sm">
                    <p className="text-muted-foreground">Model: {replySummary.model}</p>
                    <Textarea readOnly value={replySummary.summary} className="h-32" />
                    <p className="text-xs text-muted-foreground">
                      Likes: {replySummary.likeCount} • Reply #{replySummary.postNumber}
                    </p>
                  </div>
                )}
                {replyError && (
                  <p className="text-xs text-destructive">{replyError}</p>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </>
  );
}
