import {
  pgTable,
  varchar,
  jsonb,
  text,
  timestamp,
  index,
  uniqueIndex,
  integer,
  primaryKey,
  boolean,
  real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Evaluation } from "@/types/evaluation";

// Export type for TypeScript
export type ScreeningResult = typeof screeningResults.$inferSelect;
export type NewScreeningResult = typeof screeningResults.$inferInsert;

/**
 * Screening results table
 *
 * Composite primary key (topicId, revisionNumber)
 *
 * Evaluation structure:
 * - 6 quality criteria (complete, legible, consistent, compliant, justified, measurable)
 * - 2 attention scores (relevant, material)
 * - Computed scores (qualityScore, attentionScore)
 */
export const screeningResults = pgTable(
  "screening_results",
  {
    topicId: varchar("topic_id", { length: 255 }).notNull(),
    revisionNumber: integer("revision_number").notNull(),
    evaluation: jsonb("evaluation").$type<Evaluation>().notNull(),
    title: text("title").notNull(),
    nearAccount: varchar("near_account", { length: 255 }).notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Optional: store when the revision was created in the forum
    revisionTimestamp: timestamp("revision_timestamp", { withTimezone: true }),

    // Computed columns for efficient querying (extracted from evaluation JSON)
    // These can be generated columns or updated via triggers
    qualityScore: real("quality_score"),
    attentionScore: real("attention_score"),
  },
  (table) => ({
    // Composite primary key
    pk: primaryKey({ columns: [table.topicId, table.revisionNumber] }),

    // Index on topicId for querying all revisions of a topic
    topicIdIdx: index("idx_screening_results_topic_id").on(table.topicId),

    // Index on near_account for filtering by account
    nearAccountIdx: index("idx_screening_results_near_account").on(
      table.nearAccount
    ),

    // Index on timestamp for sorting (DESC for newest first)
    timestampIdx: index("idx_screening_results_timestamp").on(
      table.timestamp.desc()
    ),

    // Index on JSON field for filtering by pass/fail
    overallPassIdx: index("idx_screening_results_overall_pass").on(
      sql`((evaluation->>'overallPass')::boolean)`
    ),

    // Composite index for efficient topic + revision lookups
    topicRevisionIdx: index("idx_screening_results_topic_revision").on(
      table.topicId,
      table.revisionNumber.desc()
    ),

    // NEW: Index on qualityScore for filtering/sorting by quality
    qualityScoreIdx: index("idx_screening_results_quality_score").on(
      table.qualityScore
    ),

    // NEW: Index on attentionScore for filtering/sorting by attention
    attentionScoreIdx: index("idx_screening_results_attention_score").on(
      table.attentionScore
    ),

    // NEW: JSON indexes for new criteria
    relevantScoreIdx: index("idx_screening_results_relevant").on(
      sql`(evaluation->'relevant'->>'score')`
    ),
    materialScoreIdx: index("idx_screening_results_material").on(
      sql`(evaluation->'material'->>'score')`
    ),
  })
);

/**
 * Better Auth Schema for PostgreSQL
 * Includes: user, session, account, verification, nearAccount, discourseAccount
 */

// =============================================================================
// Core Better Auth Tables
// =============================================================================

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => ({
    userIdIdx: index("idx_session_user_id").on(table.userId),
    tokenIdx: index("idx_session_token").on(table.token),
  })
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_account_user_id").on(table.userId),
    providerIdx: index("idx_account_provider").on(
      table.providerId,
      table.accountId
    ),
    providerAccountUnique: uniqueIndex("uq_account_provider_account").on(
      table.providerId,
      table.accountId
    ),
  })
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    identifierIdx: index("idx_verification_identifier").on(table.identifier),
  })
);

// =============================================================================
// NEAR Account Table (from better-near-auth siwn plugin)
// =============================================================================

export const nearAccount = pgTable(
  "near_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    network: text("network").notNull(),
    publicKey: text("public_key").notNull(),
    isPrimary: boolean("is_primary").default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_near_account_user_id").on(table.userId),
    accountIdIdx: index("idx_near_account_account_id").on(table.accountId),
    networkAccountIdx: index("idx_near_account_network").on(
      table.network,
      table.accountId
    ),
    networkAccountUnique: uniqueIndex("uq_near_account_network_account").on(
      table.network,
      table.accountId
    ),
  })
);

// =============================================================================
// Discourse Account Table (for Discourse plugin integration)
// =============================================================================

export const discourseAccount = pgTable(
  "discourse_account",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    discourseUsername: text("discourse_username").notNull(),
    discourseUserId: text("discourse_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_discourse_account_user_id").on(table.userId),
    discourseUsernameIdx: index("idx_discourse_account_username").on(
      table.discourseUsername
    ),
    discourseUsernameUnique: uniqueIndex("uq_discourse_account_username").on(
      table.discourseUsername
    ),
    discourseUserIdIdx: index("idx_discourse_account_discourse_user_id").on(
      table.discourseUserId
    ),
  })
);

// =============================================================================
// Type Exports
// =============================================================================

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

export type NearAccount = typeof nearAccount.$inferSelect;
export type NewNearAccount = typeof nearAccount.$inferInsert;

export type DiscourseAccount = typeof discourseAccount.$inferSelect;
export type NewDiscourseAccount = typeof discourseAccount.$inferInsert;
