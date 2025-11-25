import type { NextApiRequest, NextApiResponse } from "next";
import { servicesConfig } from "@/config/services";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { username } = req.query;

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!username || Array.isArray(username)) {
    return res.status(400).json({ error: "Username is required" });
  }

  const apiKey = process.env.DISCOURSE_API_KEY;
  const apiUsername =
    process.env.DISCOURSE_API_USERNAME || process.env.DISCOURSE_API_USER;

  if (!apiKey || !apiUsername) {
    console.error("Discourse API credentials are not configured.");
    return res
      .status(500)
      .json({ error: "Discourse API credentials are missing." });
  }

  try {
    const remoteResponse = await fetch(
      `${servicesConfig.discourseBaseUrl}/u/${encodeURIComponent(
        username
      )}.json`,
      {
        headers: {
          Accept: "application/json",
          "Api-Key": apiKey,
          "Api-Username": apiUsername,
        },
      }
    );

    if (!remoteResponse.ok) {
      return res.status(remoteResponse.status).json({
        error: `Failed to fetch user data (${remoteResponse.status})`,
      });
    }

    const data = await remoteResponse.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Failed to proxy discourse user data:", error);
    return res.status(500).json({ error: "Unable to load badges right now." });
  }
}
