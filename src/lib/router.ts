import "server-only";

import { createPluginRuntime } from "every-plugin";
import { protectedProcedure, publicProcedure } from "./procedures";
import { ORPCError } from "@orpc/server";

const runtime = createPluginRuntime({
  registry: {
    "discourse-plugin": {
      remoteUrl:
        "https://jlwaugh-54-discourse-plugin-discourse-plugin-near-4c12399ef-ze.zephyrcloud.app/remoteEntry.js",
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
      discourseUrl: process.env.DISCOURSE_URL || "https://gov.near.org",
      discourseApiUsername: process.env.DISCOURSE_API_USERNAME || "gov",
      clientId: process.env.DISCOURSE_CLIENT_ID || "discourse-plugin",
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
      unlink: protectedProcedure.handler(async ({ input, context }) => {
        const nearAccount =
          typeof input === "object" &&
          input !== null &&
          "nearAccount" in input &&
          typeof (input as any).nearAccount === "string"
            ? (input as any).nearAccount
            : undefined;

        if (!nearAccount) {
          throw new ORPCError("BAD_REQUEST", {
            message: "nearAccount is required to unlink Discourse account",
          });
        }

        const unlinkFn = (discourseRouter as any).linkageStore?.unlink;
        if (typeof unlinkFn !== "function") {
          throw new ORPCError("NOT_FOUND", {
            message: "Discourse unlink not supported by plugin",
          });
        }

        await unlinkFn(nearAccount);
        return { success: true };
      }),
    }),
  },
});
