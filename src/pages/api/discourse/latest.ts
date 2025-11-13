import type { NextApiRequest, NextApiResponse } from "next";
import { servicesConfig } from "@/config/services";
import type {
  DiscourseTopicListResponse,
  DiscourseTopicListTopic,
  DiscourseUserRef,
} from "@/types/discourse";

type LatestPostsResponse = {
  latest_posts: Array<{
    id: number;
    title: string;
    excerpt: string;
    created_at: string;
    username: string;
    topic_id: number;
    topic_slug: string;
    reply_count: number;
    views: number;
    last_posted_at: string;
    like_count: number;
    posts_count: number;
    pinned: boolean;
    closed: boolean;
    archived: boolean;
    visible: boolean;
    category_id?: number;
  }>;
  can_create_topic: boolean;
  per_page: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LatestPostsResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const DISCOURSE_URL = servicesConfig.discourseBaseUrl;

    // Use category-specific endpoint for proposals (category 168)
    const perPage = req.query.per_page || 30;
    const url = `${DISCOURSE_URL}/c/house-of-stake/proposals/168.json?per_page=${perPage}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Discourse API error: ${response.status}`);
    }

    const data: DiscourseTopicListResponse = await response.json();

    // Helper function to clean HTML from excerpt
    const cleanExcerpt = (html: string): string => {
      if (!html) return "";

      // Remove HTML tags completely
      let text = html.replace(/<[^>]*>/g, "");

      // Remove emoji shortcodes like :sparkles:
      text = text.replace(/:[a-z_]+:/g, "");

      // Decode ALL HTML entities
      text = text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&hellip;/g, "...")
        .replace(/&nbsp;/g, " ")
        .replace(/&mdash;/g, "—")
        .replace(/&ndash;/g, "–")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"');

      // Decode numeric entities
      text = text.replace(/&#(\d+);/g, (match, dec) =>
        String.fromCharCode(dec)
      );
      text = text.replace(/&#x([0-9a-f]+);/gi, (match, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );

      // Clean up excessive whitespace
      text = text.replace(/\s+/g, " ").trim();

      // Limit length
      if (text.length > 200) {
        text = text.substring(0, 197) + "...";
      }

      return text;
    };

    // Filter out the "About the Proposals category" topic
    const transformedPosts =
      data.topic_list?.topics
        ?.filter((topic: DiscourseTopicListTopic) => topic.id !== 41681) // Exclude the "About" topic
        ?.map((topic: DiscourseTopicListTopic) => {
          const creatorPosterId = topic.posters?.[0]?.user_id;
          const creatorUser = data.users?.find(
            (u: DiscourseUserRef) => u.id === creatorPosterId
          );

          return {
            id: topic.id,
            title: topic.title,
            excerpt: cleanExcerpt(topic.excerpt || ""),
            created_at: topic.created_at,
            username: creatorUser?.username || "unknown",
            topic_id: topic.id,
            topic_slug: topic.slug,
            reply_count: topic.posts_count
              ? topic.posts_count - 1
              : topic.reply_count || 0,
            views: topic.views || 0,
            last_posted_at: topic.last_posted_at || topic.created_at,
            like_count: topic.like_count || 0,
            posts_count: topic.posts_count || 0,
            pinned: topic.pinned || false,
            closed: topic.closed || false,
            archived: topic.archived || false,
            visible: topic.visible !== false,
            category_id: topic.category_id,
          };
        }) || [];

    res.status(200).json({
      latest_posts: transformedPosts,
      can_create_topic: data.topic_list?.can_create_topic || false,
      per_page: data.topic_list?.per_page || 30,
    });
  } catch (error: unknown) {
    console.error("Error fetching Discourse posts:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch posts from Discourse";
    res.status(500).json({
      error: message,
    });
  }
}
