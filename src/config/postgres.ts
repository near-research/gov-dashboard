const isProd = process.env.NODE_ENV === "production";

const DEFAULT_LOCAL_DB =
  process.env.LOCAL_DATABASE_URL || "postgres://localhost:5432/near_gov";
const DEFAULT_RAILWAY_DB =
  process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

if (!DEFAULT_RAILWAY_DB && isProd) {
  throw new Error(
    "DATABASE_URL/RAILWAY_DATABASE_URL must be set in production for Postgres access."
  );
}

export const postgresConfig = {
  url: isProd ? DEFAULT_RAILWAY_DB! : DEFAULT_LOCAL_DB,
};
