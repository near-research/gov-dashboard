import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, ExternalLink, Calendar, User } from "lucide-react";
import { useRouter } from "next/router";
import { servicesConfig } from "@/config/services";

interface ProposalCardProps {
  id: number;
  title: string;
  excerpt?: string;
  created_at: string;
  username: string;
  topic_id: number;
  topic_slug: string;
  reply_count?: number;
  views?: number;
  last_posted_at?: string;
  near_wallet?: string;
}

export default function ProposalCard({
  id,
  title,
  excerpt,
  created_at,
  username,
  topic_id,
  topic_slug,
  reply_count = 0,
  views = 0,
  last_posted_at,
  near_wallet,
}: ProposalCardProps) {
  const router = useRouter();

  const getDaysSinceActivity = (lastPostedAt?: string) => {
    if (!lastPostedAt) return null;
    const now = new Date();
    const lastActivity = new Date(lastPostedAt);
    const diffTime = Math.abs(now.getTime() - lastActivity.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const handleCardClick = () => {
    router.push(`/proposals/${topic_id}`);
  };

  const handleDiscourseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(
      `${servicesConfig.discourseBaseUrl}/t/${topic_slug}/${topic_id}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const daysSinceActivity = getDaysSinceActivity(last_posted_at);

  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-md border-l-4 border-l-border hover:border-l-primary group"
      onClick={handleCardClick}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold group-hover:text-primary transition-colors flex-1">
            {title}
          </h3>
          {daysSinceActivity !== null && (
            <Badge variant="secondary" className="shrink-0">
              {daysSinceActivity}d ago
            </Badge>
          )}
        </div>

        <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            <strong>@{username}</strong>
          </span>
          {near_wallet && (
            <>
              <span>•</span>
              <span>{near_wallet}</span>
            </>
          )}
          <span>•</span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </CardDescription>
      </CardHeader>

      {excerpt && (
        <CardContent className="pb-4">
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
            {excerpt}
          </p>
        </CardContent>
      )}

      <CardContent className="pt-0">
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 gap-1"
            onClick={handleDiscourseClick}
          >
            View on Discourse
            <ExternalLink className="h-3 w-3" />
          </Button>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            <span>{formatNumber(reply_count)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
