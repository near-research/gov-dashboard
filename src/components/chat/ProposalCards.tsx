"use client";

import ProposalCard from "@/components/proposal/ProposalCard";
import type { ProposalDisplayData } from "@/components/proposal/types/proposals";

interface ProposalCardsProps {
  proposalList: ProposalDisplayData;
}

export function ProposalCards({ proposalList }: ProposalCardsProps) {
  if (!proposalList?.topics?.length) {
    return null;
  }

  const renderReplyCount = (topic: ProposalDisplayData["topics"][number]) =>
    topic.reply_count ?? topic.posts_count ?? 0;

  return (
    <div className="space-y-3">
      {proposalList.description && (
        <p className="text-sm text-muted-foreground">{proposalList.description}</p>
      )}
      <div className="space-y-3">
        {proposalList.topics.map((topic, index) => (
          <ProposalCard
            key={`${topic.id}-${index}`}
            id={topic.id}
            title={topic.title}
            excerpt={topic.excerpt}
            created_at={topic.created_at}
            username={topic.author}
            topic_id={topic.id}
            topic_slug={topic.slug}
            reply_count={renderReplyCount(topic)}
            views={topic.views ?? 0}
            last_posted_at={topic.last_posted_at}
          />
        ))}
      </div>
    </div>
  );
}
