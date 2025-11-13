import type { NextApiRequest, NextApiResponse } from "next";
import { extractMetadata, stripFrontmatter } from "@/utils/metadata";
import { servicesConfig } from "@/config/services";
import type {
  DiscourseActionSummary,
  DiscoursePost,
  DiscoursePostDetail,
  DiscourseTopic,
} from "@/types/discourse";
import type { ProposalDetailResponse } from "@/types/proposals";

/**
 * GET /api/proposals/[id]
 *
 * Fetches a proposal (Discourse topic) with all its details and replies.
 * Public endpoint - no authentication required.
 *
 * Returns:
 * - Proposal details (first post)
 * - Raw markdown content and clean content (without frontmatter)
 * - Extracted frontmatter metadata
 * - All replies
 * - Metadata (views, likes, timestamps)
 * - NEAR wallet if mentioned in proposal
 * - Version number for revision tracking
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProposalDetailResponse | { error: string; status?: number; message?: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid proposal ID" });
  }

  try {
    const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const topicResponse = await fetch(`${DISCOURSE_URL}/t/${id}.json`, {
      headers,
    });

    if (!topicResponse.ok) {
      return res.status(topicResponse.status).json({
        error: "Failed to fetch proposal",
        status: topicResponse.status,
      } as const);
    }

    const topicData: DiscourseTopic = await topicResponse.json();

    const firstPost: DiscoursePost | undefined =
      topicData.post_stream?.posts?.[0];

    if (!firstPost) {
      return res.status(404).json({ error: "Proposal post not found" });
    }

    let rawContent = "";
    try {
      const postId = firstPost.id;
      const postResponse = await fetch(
        `${DISCOURSE_URL}/posts/${postId}.json`,
        {
          headers,
        }
      );

      if (postResponse.ok) {
        const postData: DiscoursePostDetail = await postResponse.json();
        rawContent = postData.raw || "";
      }
    } catch (err) {
      console.warn(
        `[Proposal] Could not fetch raw content for post ${firstPost.id}:`,
        err
      );
    }

    const content = rawContent || firstPost.cooked;

    const metadata = extractMetadata(content);

    const contentWithoutFrontmatter = stripFrontmatter(content);

    const replies = topicData.post_stream.posts.slice(1).map((post) => {
      const likeCount =
        post.actions_summary?.find(
          (action: DiscourseActionSummary) => action.id === 2
        )?.count ??
        post.like_count ??
        0;

      return {
        id: post.id,
        username: post.username,
        created_at: post.created_at,
        cooked: post.cooked,
        post_number: post.post_number,
        like_count: likeCount,
        reply_to_post_number: post.reply_to_post_number || null,
        reply_to_user: post.reply_to_user || null,
        avatar_template: post.avatar_template || null,
      };
    });

    const nearWalletMatch = content.match(
      /(?:NEAR Account|Wallet|Account)[\s:]*([a-z0-9\-_]+\.near)/i
    );

    const proposalDetail: ProposalDetailResponse = {
      id: firstPost.id,
      title: topicData.title,
      content: content,
      contentWithoutFrontmatter: contentWithoutFrontmatter,
      metadata: metadata,
      version: firstPost.version || 1,
      created_at: firstPost.created_at,
      username: firstPost.username,
      topic_id: topicData.id,
      topic_slug: topicData.slug,
      reply_count: topicData.posts_count - 1,
      views: topicData.views,
      last_posted_at: topicData.last_posted_at ?? firstPost.created_at,
      like_count:
        topicData.like_count ??
        topicData.actions_summary?.find(
          (action: DiscourseActionSummary) => action.id === 2
        )?.count ??
        0,
      near_wallet: nearWalletMatch ? nearWalletMatch[1] : null,
      category_id: topicData.category_id,
      replies: replies,
    };

    console.log(
      `[Proposal] Fetched topic ${id}: "${topicData.title}" by @${
        firstPost.username
      } v${firstPost.version || 1} (using ${
        rawContent ? "raw" : "cooked"
      } content)`
    );

    return res.status(200).json(proposalDetail);
  } catch (error: unknown) {
    console.error("[Proposal] Error fetching proposal details:", error);
    const message = error instanceof Error ? error.message : undefined;
    return res.status(500).json({
      error: "Failed to fetch proposal details",
      message,
    });
  }
}
