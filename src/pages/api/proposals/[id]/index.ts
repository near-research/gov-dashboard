import type { NextApiRequest, NextApiResponse } from "next";
import { extractMetadata, stripFrontmatter } from "@/utils/metadata";
import { servicesConfig } from "@/config/services";
import type {
  DiscourseActionSummary,
  DiscoursePost,
  DiscoursePostDetail,
  DiscourseTopic,
} from "@/types/discourse";
import type { ProposalDetailResponse } from "@/components/proposal/types/proposals";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

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
  res: NextApiResponse<
    | ProposalDetailResponse
    | { error: string; status?: number; message?: string }
  >
) {
  if (req.method !== "GET") {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, "Method not allowed", 405)
    );
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return respondWithError(
      res,
      new ApiError(ErrorCodes.VALIDATION_ERROR, "Invalid proposal ID", 400)
    );
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
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.UPSTREAM_ERROR,
          "Failed to fetch proposal",
          topicResponse.status,
          { upstreamStatus: topicResponse.status }
        )
      );
    }

    const topicData: DiscourseTopic = await topicResponse.json();

    const firstPost: DiscoursePost | undefined =
      topicData.post_stream?.posts?.[0];

    if (!firstPost) {
      return respondWithError(
        res,
        new ApiError(
          ErrorCodes.NOT_FOUND,
          "Proposal post not found",
          404
        )
      );
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
      logger.warn(
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

    logger.debug(
      `[Proposal] Fetched topic ${id}: "${topicData.title}" by @${
        firstPost.username
      } v${firstPost.version || 1} (using ${
        rawContent ? "raw" : "cooked"
      } content)`
    );

    return res.status(200).json(proposalDetail);
  } catch (error: unknown) {
    logger.error("[Proposal] Error fetching proposal details:", error);
    const message = error instanceof Error ? error.message : undefined;
    return respondWithError(
      res,
      new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to fetch proposal details",
        500,
        message ? { message } : undefined
      )
    );
  }
}
