import type { NextApiRequest, NextApiResponse } from "next";
import { servicesConfig } from "@/config/services";
import type { DiscourseSearchResponse } from "@/types/discourse";

type SearchErrorResponse = { error: string };

const PROPOSALS_CATEGORY_ID = Number(
  process.env.DISCOURSE_PROPOSALS_CATEGORY_ID || 168
);

/**
 * GET /api/discourse/search
 *
 * Proxies search requests to the configured Discourse instance.
 * Requires a `q` (query) parameter, optionally accepts `page`.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DiscourseSearchResponse | SearchErrorResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { q, page } = req.query;

  if (!q || (Array.isArray(q) && q.length === 0)) {
    return res.status(400).json({ error: "Missing search query `q`" });
  }

  if (Array.isArray(q)) {
    return res
      .status(400)
      .json({ error: "Multiple `q` parameters provided. Use a single value." });
  }

  const trimmedQuery = q.trim();
  if (!trimmedQuery) {
    return res.status(400).json({ error: "Search query cannot be empty" });
  }

  let pageValue: string | undefined;
  if (typeof page === "string" && page.length > 0) {
    const parsedPage = Number.parseInt(page, 10);
    if (Number.isNaN(parsedPage) || parsedPage < 1) {
      return res.status(400).json({ error: "Invalid `page` parameter" });
    }
    pageValue = parsedPage.toString();
  } else if (Array.isArray(page)) {
    return res.status(400).json({
      error: "Multiple `page` parameters provided. Use a single value.",
    });
  }

  try {
    const searchUrl = new URL(`${servicesConfig.discourseBaseUrl}/search.json`);
    searchUrl.searchParams.set("q", trimmedQuery);
    searchUrl.searchParams.set("search_context[type]", "category");
    searchUrl.searchParams.set(
      "search_context[id]",
      PROPOSALS_CATEGORY_ID.toString()
    );
    if (pageValue) {
      searchUrl.searchParams.set("page", pageValue);
    }

    const response = await fetch(searchUrl.toString(), {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Discourse API error: ${response.status}`);
    }

    const data: DiscourseSearchResponse = await response.json();
    return res.status(200).json(data);
  } catch (error: unknown) {
    console.error("Error searching Discourse:", error);
    const message =
      error instanceof Error ? error.message : "Failed to search Discourse";
    return res.status(500).json({
      error: message,
    });
  }
}
