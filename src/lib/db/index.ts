import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { postgresConfig } from "@/config/postgres";

const MAX_CONNECTIONS = Math.max(
  1,
  Number(process.env.POSTGRES_MAX_CONNECTIONS ?? 6)
);
const RETRY_LIMIT = Math.max(
  1,
  Number(process.env.POSTGRES_CONNECT_RETRIES ?? 3)
);
const BACKOFF_BASE_MS = Math.max(
  50,
  Number(process.env.POSTGRES_BACKOFF_BASE_MS ?? 200)
);
const BACKOFF_MAX_MS = Math.max(
  BACKOFF_BASE_MS,
  Number(process.env.POSTGRES_BACKOFF_MAX_MS ?? 2000)
);

const postgresOptions = {
  max: MAX_CONNECTIONS,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function createClientWithRetry() {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < RETRY_LIMIT) {
    attempt += 1;
    const client = postgres(postgresConfig.url, postgresOptions);

    try {
      await client`SELECT 1`;
      return client;
    } catch (error) {
      lastError = error;
      if (typeof client.end === "function") {
        try {
          await client.end();
        } catch {
          // ignore close errors
        }
      }

      if (attempt >= RETRY_LIMIT) {
        break;
      }

      const backoff = Math.min(
        BACKOFF_BASE_MS * 2 ** (attempt - 1),
        BACKOFF_MAX_MS
      );
      await sleep(backoff);
    }
  }

  throw lastError;
}

const shouldSkipDb =
  process.env.NODE_ENV === "test" && process.env.TEST_USE_DATABASE !== "1";

export type DrizzleClient = ReturnType<typeof drizzle>;

let db: DrizzleClient;
if (shouldSkipDb) {
  db = {} as DrizzleClient;
} else {
  const client = await createClientWithRetry();
  db = drizzle(client, {
    schema: { ...schema },
  });
}

export { db };
export { schema };
