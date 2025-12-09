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

const proxyPublic = (
  fn: (args: { input: unknown; context: unknown }) => Promise<unknown>
) =>
  publicProcedure.handler(async ({ input, context }) => fn({ input, context }));

const proxyProtected = (
  fn: (args: { input: unknown; context: unknown }) => Promise<unknown>
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

const resolvePath = (obj: unknown, path: string[]) =>
  path.reduce<unknown | undefined>(
    (value, key) =>
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined,
    obj
  );

const logRouterShape = () => {
  const globalAny = globalThis as unknown as Record<string, unknown>;
  if (globalAny.__discourseRouterKeysLogged) {
    return;
  }
  globalAny.__discourseRouterKeysLogged = true;

  console.log(
    "discourseRouter keys",
    Object.keys(discourseRouter).sort().join(", ")
  );
  console.log(
    "authRoutes keys",
    Object.keys((discourseRouter as Record<string, unknown>)?.authRoutes ?? {})
      .sort()
      .join(", ")
  );
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
      console.log(
        `[discourse] Invoking ${procedureName} handler with input:`,
        JSON.stringify(args.input, null, 2)
      );
      const result = await handler({
        input: args.input,
        context: args.context,
        errors: orpcInternal.errorMap ?? {},
      });
      console.log(
        `[discourse] ${procedureName} handler returned:`,
        JSON.stringify(result, null, 2)
      );
      return result;
    } catch (error) {
      console.error(`[discourse] ${procedureName} handler threw error:`, error);
      console.error(
        `[discourse] Error type:`,
        Object.prototype.toString.call(error)
      );
      console.error(
        `[discourse] Error constructor:`,
        (error as any)?.constructor?.name
      );
      if (error instanceof Error) {
        const stackLines = error.stack?.split("\n") ?? [];
        stackLines.forEach((line, i) => console.error(`[stack ${i}]`, line));
      }
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
      console.log(
        `[discourse] Invoking ${procedureName} direct handler with input:`,
        JSON.stringify(args.input, null, 2)
      );
      const result = await handler.call(proc, {
        input: args.input,
        context: args.context,
        errors: proc.errors ?? {},
      });
      console.log(
        `[discourse] ${procedureName} direct handler returned:`,
        JSON.stringify(result, null, 2)
      );
      return result;
    } catch (error) {
      console.error(
        `[discourse] ${procedureName} direct handler threw error:`,
        error
      );
      throw error;
    }
  }

  return null;
};

const callAuthRoute = async (
  name: string,
  args: { input: unknown; context: unknown }
) => {
  logRouterShape();

  const direct = (discourseRouter as Record<string, unknown>)[name];

  console.trace(
    "[discourse] direct candidate",
    name,
    direct ? "B" : "NOT_FOUND"
  );

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
      console.error(`[discourse] Error invoking ${name}:`, error);
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
    const candidate = resolvePath(discourseRouter, path as unknown as string[]);
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
      console.error(
        `[discourse] Error invoking procedure at path ${path.join(".")}:`,
        error
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
      console.log("[completeLink] Starting with input keys:", inputKeys);
      try {
        const result = await callAuthRoute("completeLink", { input, context });
        console.log("[completeLink] Success");
        return result;
      } catch (error) {
        const e = error as Error;
        process.stdout.write("\n========== RAW ERROR ==========\n");
        process.stdout.write(`Name: ${e?.name}\n`);
        process.stdout.write(`Message: ${e?.message}\n`);
        process.stdout.write(`Cause: ${JSON.stringify((e as any)?.cause)}\n`);
        process.stdout.write("===============================\n");
        throw error;
      }
    }),
    getLinkage: publicProcedure.handler(async ({ input, context }) => {
      const nearAccount = parseNearAccountInput(input);
      return getDiscourseLinkageFromDb(
        nearAccount,
        context.session?.user?.id ?? null
      );
    }),
    ping: proxyPublic(({ input }) =>
      (
        discourseRouter as Record<string, (input: unknown) => Promise<unknown>>
      ).ping(input)
    ),
    createPost: proxyProtected(({ input }) =>
      (
        discourseRouter as Record<string, (input: unknown) => Promise<unknown>>
      ).createPost(input)
    ),
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
      if (typeof unlinkFn?.unlink !== "function") {
        throw new ORPCError("NOT_FOUND", {
          message: "Discourse unlink not supported by plugin",
        });
      }

      await (unlinkFn.unlink as (account: string) => Promise<void>)(
        nearAccount as string
      );
      return { success: true };
    }),
  }),
});
