import "server-only";

import { createPluginRuntime } from "every-plugin";
import { protectedProcedure, publicProcedure } from "./procedures";
import { ORPCError } from "@orpc/server";
import { wrapDiscoursePluginError } from "@/server/plugins/discourse-errors";

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

type DiscourseRuntimeResult = Awaited<ReturnType<typeof runtime.usePlugin>>;

let discourseRouter: DiscourseRuntimeResult["router"];

try {
  const { router } = await runtime.usePlugin("discourse-plugin", {
    variables: {
      discourseUrl: process.env.DISCOURSE_URL || "https://gov.near.org",
      discourseApiUsername: process.env.DISCOURSE_API_USERNAME || "gov",
      clientId: process.env.DISCOURSE_CLIENT_ID || "discourse-plugin",
    },
    secrets: { discourseApiKey: "{{DISCOURSE_API_KEY}}" },
  });
  discourseRouter = router;
} catch (error) {
  wrapDiscoursePluginError(error);
}

const proxyPublic =
  (fn: (input: unknown) => Promise<unknown>) =>
  publicProcedure.handler(async ({ input }) => fn(input));

const proxyProtected =
  (fn: (input: unknown) => Promise<unknown>) =>
  protectedProcedure.handler(async ({ input }) => fn(input));

export const router = publicProcedure.router({
  healthCheck: publicProcedure.handler(() => "OK"),
  discourse: publicProcedure.router({
    getUserApiAuthUrl: proxyPublic((input) =>
      discourseRouter.getUserApiAuthUrl(input as any),
    ),
    completeLink: proxyPublic((input) =>
      discourseRouter.completeLink(input as any),
    ),
    getLinkage: proxyPublic((input) =>
      discourseRouter.getLinkage(input as any),
    ),
    ping: proxyPublic((input) => discourseRouter.ping(input as any)),
    createPost: proxyProtected((input) =>
      discourseRouter.createPost(input as any),
    ),
    unlink: protectedProcedure.handler(async ({ input }) => {
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
});
