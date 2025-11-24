import { useEffect, useState } from "react";
import ProposalCard from "@/components/proposal/ProposalCard";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import type { LatestPostsResponse } from "@/types/discourse";
import { useGovernanceAnalytics } from "@/lib/analytics";

type Post = LatestPostsResponse["latest_posts"][number] & {
  near_wallet?: string;
};

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const track = useGovernanceAnalytics();

  useEffect(() => {
    fetchProposals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchProposals = async () => {
    setLoading(true);
    setError("");

    // track request start
    track("home_latest_proposals_requested");

    try {
      const response = await fetch("/api/discourse/latest");

      if (!response.ok) {
        throw new Error("Failed to fetch proposals");
      }

      const data: LatestPostsResponse = await response.json();
      const latestPosts = data.latest_posts || [];
      setPosts(latestPosts);

      // track success
      track("home_latest_proposals_succeeded", {
        props: {
          count: latestPosts.length,
        },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch proposals";
      setError(message);

      // track failure
      track("home_latest_proposals_failed", {
        props: {
          message: message.slice(0, 120),
        },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Proposals</h1>
          <p className="text-muted-foreground">
            Browse and analyze NEAR governance proposals
          </p>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <div className="flex gap-4 pt-2">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Empty State */}
        {!loading && !error && posts.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">No proposals found</h3>
                <p className="text-sm text-muted-foreground">
                  Check back later for new proposals
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Proposals List */}
        {!loading && !error && posts.length > 0 && (
          <div className="space-y-4">
            {posts.map((post) => (
              <ProposalCard
                key={post.id}
                id={post.id}
                title={post.title}
                excerpt={post.excerpt}
                created_at={post.created_at}
                username={post.username}
                topic_id={post.topic_id}
                topic_slug={post.topic_slug}
                reply_count={post.reply_count}
                views={post.views}
                last_posted_at={post.last_posted_at}
                near_wallet={post.near_wallet}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
