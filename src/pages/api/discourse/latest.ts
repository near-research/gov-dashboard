import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const DISCOURSE_URL = process.env.DISCOURSE_URL || "https://gov.near.org";

    // Fetch latest topics with optional query parameters
    const order = req.query.order || "default";
    const perPage = req.query.per_page || 100;

    // Use category-specific endpoint
    const url = `${DISCOURSE_URL}/latest.json?order=${order}&per_page=${perPage}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Discourse API error: ${response.status}`);
    }

    const data = await response.json();

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

    const transformedPosts =
      data.topic_list?.topics
        ?.filter((topic: any) => topic.category_id === 168)
        ?.map((topic: any) => {
          const creatorPosterId = topic.posters?.[0]?.user_id;
          const creatorUser = data.users?.find(
            (u: any) => u.id === creatorPosterId
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
  } catch (error: any) {
    console.error("Error fetching Discourse posts:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch posts from Discourse",
    });
  }
}
