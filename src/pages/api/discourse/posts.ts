import type { NextApiRequest, NextApiResponse } from "next";
import { servicesConfig } from "@/config/services";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch(
      `${servicesConfig.discourseBaseUrl}/posts.json`
    );

    if (!response.ok) {
      throw new Error(`Discourse API error: ${response.status}`);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error: unknown) {
    console.error("Error fetching Discourse posts:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch posts from Discourse";
    res.status(500).json({
      error: message,
    });
  }
}
