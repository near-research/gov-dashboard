-- Align database constraints with Drizzle schema definitions.
-- Prevent duplicate provider/account pairs, NEAR account tuples, and Discourse usernames.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_account_provider_account" ON "account" ("provider_id", "account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_near_account_network_account" ON "near_account" ("network", "account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_discourse_account_username" ON "discourse_account" ("discourse_username");
