import "server-only";

import { desc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db, type DrizzleClient } from "@/lib/db";
import {
  discourseAccount,
  nearAccount as nearAccountTable,
} from "@/lib/db/schema";
import { DiscourseRouter, discourseRouter } from "@/server/plugins/discourse";
import { protectedProcedure, publicProcedure } from "./procedures";
import type { Context } from "@/lib/context";
import type { DiscourseCompleteLinkResult } from "@/types/discourse-linkage";
import { logger } from "@/lib/logger";

type ErrorWithCause = Error & { cause?: unknown };

const proxyPublic = (
  fn: (args: { input: unknown; context: Context | undefined }) => Promise<unknown>
) =>
  publicProcedure.handler(async ({ input, context }) => fn({ input, context }));

const proxyProtected = (
  fn: (args: { input: unknown; context: Context }) => Promise<unknown>
) =>
  protectedProcedure.handler(async ({ input, context }) =>
    fn({ input, context })
  );

const parseNearAccountInput = (input: unknown): string | null => {
  if (typeof input === "object" && input !== null && "nearAccount" in input) {
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

const persistDiscourseLinkage = async (
  linkage: DiscourseCompleteLinkResult | null,
  userId: string | null | undefined
) => {
  if (!linkage || !userId) {
    return;
  }

  const { discourseUsername, discourseUserId } = linkage;
  if (!discourseUsername || discourseUserId === undefined) {
    return;
  }

  const drizzleClient = db as DrizzleClient;
  if (typeof drizzleClient.insert !== "function") {
    return;
  }

  const existing = await drizzleClient
    .select({
      id: discourseAccount.id,
    })
    .from(discourseAccount)
    .where(eq(discourseAccount.discourseUsername, discourseUsername))
    .limit(1);

  if (existing.length) {
    await drizzleClient
      .update(discourseAccount)
      .set({
        userId,
        discourseUserId: String(discourseUserId),
        updatedAt: new Date(),
      })
      .where(eq(discourseAccount.discourseUsername, discourseUsername));
    return;
  }

  await drizzleClient.insert(discourseAccount).values({
    userId,
    discourseUsername,
    discourseUserId: String(discourseUserId),
  });
};

const resolvePath = (obj: unknown, path: readonly string[]) =>
  path.reduce<unknown | undefined>(
    (value, key) =>
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined,
    obj
  );

type GlobalWithRouterLogFlag = typeof globalThis & {
  __discourseRouterKeysLogged?: boolean;
};

/**
 * Guard that ensures the global object can carry the temporary logging flag.
 * This prevents unsafe casts while still letting us store the flag on the runtime global.
 */
const isGlobalWithRouterLogFlag = (
  target: unknown
): target is GlobalWithRouterLogFlag =>
  typeof target === "object" && target !== null;

const logRouterShape = () => {
  const globalCandidate: unknown = globalThis;
  if (!isGlobalWithRouterLogFlag(globalCandidate)) {
    return;
  }

  if (globalCandidate.__discourseRouterKeysLogged) {
    return;
  }
  globalCandidate.__discourseRouterKeysLogged = true;

  logger.debug("discourseRouter keys", {
    keys: Object.keys(discourseRouter).sort(),
  });
  logger.debug("authRoutes keys", {
    keys: Object.keys((discourseRouter as Record<string, unknown>)?.authRoutes ?? {}).sort(),
  });
};

const deleteDiscourseAccountForNearAccount = async (nearAccount: string) => {
  const drizzleClient = db as DrizzleClient;
  if (
    typeof drizzleClient.select !== "function" ||
    typeof drizzleClient.delete !== "function"
  ) {
    return;
  }

  const nearRecord = await drizzleClient
    .select({ userId: nearAccountTable.userId })
    .from(nearAccountTable)
    .where(eq(nearAccountTable.accountId, nearAccount))
    .limit(1);

  const userId = nearRecord[0]?.userId;
  if (!userId) {
    return;
  }

  await drizzleClient
    .delete(discourseAccount)
    .where(eq(discourseAccount.userId, userId));
};

/**
 * Invoke an oRPC procedure, handling both direct handlers and ~orpc internal structure.
 * oRPC procedures from Module Federation store their handler in '~orpc'.handler
 */
const invokeOrpcProcedure = async (
  procedure: unknown,
  args: { input: unknown; context: unknown },
  procedureName: string
): Promise<unknown> => {
  if (!procedure || typeof procedure !== "object") {
    return null;
  }

  const proc = procedure as Record<string, unknown>;
  const orpcInternal = proc["~orpc"] as Record<string, unknown> | undefined;

  // Method 1: Check for callable procedure (some oRPC versions make procedures callable)
  if (typeof proc === "function") {
    return await (proc as (input: unknown) => Promise<unknown>)(args.input);
  }

  // Method 2: oRPC internal structure with handler in '~orpc'
  if (orpcInternal && typeof orpcInternal.handler === "function") {
    const handler = orpcInternal.handler as (args: {
      input: unknown;
      context: unknown;
      errors?: unknown;
    }) => Promise<unknown>;

    try {
      logger.debug(`[discourse] Invoking ${procedureName} handler`);
      const result = await handler({
        input: args.input,
        context: args.context,
        errors: orpcInternal.errorMap ?? {},
      });
      return result;
    } catch (error) {
      logger.error(`[discourse] ${procedureName} handler threw error`, {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  // Method 3: Direct handler property at top level
  if (typeof proc.handler === "function") {
    const handler = proc.handler as (args: {
      input: unknown;
      context: unknown;
      errors?: unknown;
    }) => Promise<unknown>;

    try {
      logger.debug(`[discourse] Invoking ${procedureName} direct handler`);
      const result = await handler.call(proc, {
        input: args.input,
        context: args.context,
        errors: proc.errors ?? {},
      });
      return result;
    } catch (error) {
      logger.error(
        `[discourse] ${procedureName} direct handler threw error`,
        {
          message: error instanceof Error ? error.message : "Unknown error",
        }
      );
      throw error;
    }
  }

  return null;
};

const callAuthRoute = async (
  name: string,
  args: { input: unknown; context: Context | undefined }
) => {
  logRouterShape();

  const direct = (discourseRouter as Record<string, unknown>)[name];

  logger.debug("[discourse] direct candidate", { route: name, found: Boolean(direct) });

  // Try to invoke the direct procedure
  if (direct) {
    try {
      const result = await invokeOrpcProcedure(direct, args, name);
      if (result !== null) {
        return result;
      }
    } catch (error) {
      // Re-throw ORPCErrors as-is
      if (error instanceof ORPCError) {
        throw error;
      }
      logger.error(`[discourse] Error invoking ${name}`, {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to execute discourse operation",
      });
    }
  }

  // Fallback: Try nested paths for older plugin structures
  const candidatePaths = [
    ["authRoutes"],
    ["auth"],
    ["router"],
    ["router", "authRoutes"],
    ["router", "auth"],
    ["contract"],
    ["router", "contract"],
  ] as const;

  for (const path of candidatePaths) {
    const candidate = resolvePath(discourseRouter, path);
    if (!candidate) {
      continue;
    }

    const candidateValue = (candidate as Record<string, unknown>)[name];
    if (!candidateValue) {
      continue;
    }

    try {
      const result = await invokeOrpcProcedure(
        candidateValue,
        args,
        `${path.join(".")}.${name}`
      );
      if (result !== null) {
        return result;
      }
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error;
      }
      logger.error(
        `[discourse] Error invoking procedure at path ${path.join(".")}`,
        {
          message: error instanceof Error ? error.message : "Unknown error",
        }
      );
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to execute discourse operation",
      });
    }

    // Legacy: direct function call
    if (typeof candidateValue === "function") {
      return await (
        candidateValue as (input: unknown) => Promise<unknown>
      ).call(candidate, args.input);
    }
  }

  throw new ORPCError("NOT_IMPLEMENTED", {
    message: "Discourse linking is not available in this environment",
  });
};

export const router = publicProcedure.router({
  healthCheck: publicProcedure.handler(() => "OK"),
  discourse: publicProcedure.router({
    initiateLink: proxyPublic(({ input, context }) =>
      callAuthRoute("initiateLink", { input, context })
    ),
    completeLink: proxyPublic(async ({ input, context }) => {
      const inputKeys =
        input && typeof input === "object"
          ? Object.keys(input as Record<string, unknown>)
          : [];
      logger.debug("[completeLink] Starting", { inputKeys });
      try {
        const result =
          (await callAuthRoute("completeLink", { input, context })) as
            | DiscourseCompleteLinkResult
            | null;
        await persistDiscourseLinkage(
          result,
          context?.session?.user?.id ?? null
        );
        logger.debug("[completeLink] Success");
        return result;
        } catch (error) {
          const typedError =
            error instanceof Error ? (error as ErrorWithCause) : undefined;
          logger.error("[completeLink] Error details", {
            name: typedError?.name,
            message: typedError?.message ?? "Unknown error",
            cause: typedError?.cause,
          });
          throw error;
        }
    }),
    getLinkage: publicProcedure.handler(async ({ input, context }) => {
      const nearAccount = parseNearAccountInput(input);
      return getDiscourseLinkageFromDb(
        nearAccount,
        context?.session?.user?.id ?? null
      );
    }),
    ping: proxyPublic(({ input }) =>
      (
        discourseRouter as Record<string, (input: unknown) => Promise<unknown>>
      ).ping(input)
    ),
    createPost: proxyProtected(async ({ input, context }) => {
      const payload = input as Record<string, unknown> | unknown;
      const sessionUserId = context?.session?.user?.id ?? null;
      const candidate = (discourseRouter as Record<string, unknown>)["createPost"];
      if (!candidate) {
        throw new ORPCError("NOT_IMPLEMENTED", {
          message: "Discourse createPost procedure is not available",
        });
      }
      try {
        const result = await invokeOrpcProcedure(
          candidate,
          { input, context },
          "createPost"
        );
        if (result !== null) {
          return result;
        }
        throw new ORPCError("NOT_IMPLEMENTED", {
          message: "Discourse createPost procedure returned no handler",
        });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : undefined;
        const errorMessage = error instanceof Error ? error.message : undefined;
        logger.error("[discourse] createPost failed", {
          payload,
          sessionUserId,
          errorName,
          errorMessage,
        });
        throw error;
      }
    }),
    unlink: protectedProcedure.handler(async ({ input }) => {
      const nearAccount =
        typeof input === "object" &&
        input !== null &&
        "nearAccount" in input &&
        typeof (input as Record<string, unknown>).nearAccount === "string"
          ? (input as Record<string, unknown>).nearAccount
          : undefined;

      if (!nearAccount) {
        throw new ORPCError("BAD_REQUEST", {
          message: "nearAccount is required to unlink Discourse account",
        });
      }

      const unlinkFn = (discourseRouter as Record<string, unknown>)
        ?.linkageStore as Record<string, unknown> | undefined;
      if (typeof unlinkFn?.unlink === "function") {
        await (unlinkFn.unlink as (account: string) => Promise<void>)(
          nearAccount as string
        );
      } else {
        logger.warn(
          "[discourse] Plugin does not expose linkageStore.unlink; skipping cleanup."
        );
      }

      await deleteDiscourseAccountForNearAccount(nearAccount as string);
      return { success: true };
    }),
  }),
});
