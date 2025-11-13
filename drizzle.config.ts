import type { Config } from "drizzle-kit";
import { postgresConfig } from "./src/config/postgres";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: postgresConfig.url,
  },
  verbose: true,
  strict: true,
} satisfies Config;
