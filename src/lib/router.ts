import "server-only";

import { createPluginRuntime } from "every-plugin";
import { protectedProcedure, publicProcedure } from "./procedures";

const runtime = createPluginRuntime({
  registry: {
    "discourse-plugin": {
      remoteUrl:
        "https://jlwaugh-25-discourse-plugin-discourse-plugin-near-4ab5fc1da-ze.zephyrcloud.app/remoteEntry.js",
    },
  },
  secrets: {
    DISCOURSE_API_KEY: process.env.DISCOURSE_API_KEY!,
  },
});

const { router: discourseRouter } = await runtime.usePlugin(
  "discourse-plugin",
  {
    variables: {
      discourseBaseUrl:
        process.env.DISCOURSE_BASE_URL || "https://gov.near.org",
      discourseApiUsername: process.env.DISCOURSE_API_USERNAME || "gov",
      clientId: process.env.DISCOURSE_CLIENT_ID || "discourse-near-plugin",
      recipient: process.env.DISCOURSE_RECIPIENT || "social.near",
    },
    secrets: { discourseApiKey: "{{DISCOURSE_API_KEY}}" },
  }
);

export const router = publicProcedure.router({
  healthCheck: publicProcedure.handler(() => "OK"),
  discourse: {
    ...publicProcedure.router({
      getUserApiAuthUrl: discourseRouter.getUserApiAuthUrl,
      completeLink: discourseRouter.completeLink,
      getLinkage: discourseRouter.getLinkage,
      ping: discourseRouter.ping,
    }),
    ...protectedProcedure.router({
      createPost: discourseRouter.createPost,
    }),
  },
});
