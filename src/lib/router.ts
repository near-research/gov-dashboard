import "server-only";

import { desc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db, type DrizzleClient } from "@/lib/db";
import { discourseAccount, nearAccount as nearAccountTable } from "@/lib/db/schema";
import { discourseRouter } from "@/server/plugins/discourse";
import { protectedProcedure, publicProcedure } from "./procedures";

const proxyPublic = (fn: (input: unknown) => Promise<unknown>) =>
  publicProcedure.handler(async ({ input }) => fn(input));

const proxyProtected = (fn: (input: unknown) => Promise<unknown>) =>
  protectedProcedure.handler(async ({ input }) => fn(input));

const parseNearAccountInput = (input: unknown): string | null => {
  if (
    typeof input === "object" &&
    input !== null &&
    "nearAccount" in input
  ) {
    const candidate = (input as Record<string, unknown>).nearAccount;
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      return trimmed.length ? trimmed : null;
    }
  }
  return null;
};

const getDiscourseLinkageFromDb = async (
  nearAccount: string | null,
  userId: string | null
) => {
  const drizzleClient = db as DrizzleClient;
  if (typeof drizzleClient.select !== "function") {
    return null;
  }

  if (!nearAccount && !userId) {
    return null;
  }

  const clause =
    nearAccount !== null
      ? eq(nearAccountTable.accountId, nearAccount)
      : userId
      ? eq(discourseAccount.userId, userId)
      : undefined;

  if (!clause) {
    return null;
  }

  const result = await drizzleClient
    .select({
      discourseUsername: discourseAccount.discourseUsername,
      discourseUserId: discourseAccount.discourseUserId,
      nearAccountId: nearAccountTable.accountId,
    })
    .from(discourseAccount)
    .leftJoin(
      nearAccountTable,
      eq(nearAccountTable.userId, discourseAccount.userId)
    )
    .where(clause)
    .orderBy(desc(discourseAccount.updatedAt))
    .limit(1);

  if (!result[0]) {
    return null;
  }

  return {
    discourseUsername: result[0].discourseUsername,
    discourseUserId: result[0].discourseUserId,
    nearAccount: result[0].nearAccountId ?? undefined,
  };
};

export const router = publicProcedure.router({
  healthCheck: publicProcedure.handler(() => "OK"),
  discourse: publicProcedure.router({
    getUserApiAuthUrl: proxyPublic((input) =>
      discourseRouter.getUserApiAuthUrl(input as any)
    ),
    completeLink: proxyPublic((input) =>
      discourseRouter.completeLink(input as any)
    ),
    getLinkage: publicProcedure.handler(async ({ input, context }) => {
      const nearAccount = parseNearAccountInput(input);
      return getDiscourseLinkageFromDb(
        nearAccount,
        context.session?.user?.id ?? null
      );
    }),
    ping: proxyPublic((input) => discourseRouter.ping(input as any)),
    createPost: proxyProtected((input) =>
      discourseRouter.createPost(input as any)
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
