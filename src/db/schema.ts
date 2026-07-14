import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  anonymizedAt: timestamp("anonymized_at", { mode: "date", withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_uidx").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const applicationRole = pgEnum("application_role", [
  "player",
  "assembler",
  "admin",
]);

export const gameplayInputFamily = pgEnum("gameplay_input_family", [
  "keyboard",
  "touch",
  "gamepad",
]);

export const gameplayRunOutcome = pgEnum("gameplay_run_outcome", [
  "completed",
  "exited",
  "load_failed",
  "runtime_failed",
]);

export const gameplayRunAttribution = pgEnum("gameplay_run_attribution", [
  "guest",
  "authenticated",
]);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: applicationRole("role").notNull(),
    grantedAt: timestamp("granted_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    grantedByUserId: text("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    index("user_roles_role_idx").on(table.role),
  ],
);

export const courses = pgTable(
  "courses",
  {
    id: text("id").primaryKey(),
    currentRevision: integer("current_revision").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    check("courses_current_revision_positive", sql`${table.currentRevision} > 0`),
  ],
);

export const courseRevisions = pgTable(
  "course_revisions",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    document: jsonb("document").notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("course_revisions_course_revision_uidx").on(
      table.courseId,
      table.revision,
    ),
    index("course_revisions_author_user_id_idx").on(table.authorUserId),
    check("course_revisions_revision_positive", sql`${table.revision} > 0`),
    check(
      "course_revisions_schema_version_positive",
      sql`${table.schemaVersion} > 0`,
    ),
  ],
);

export const coursePublications = pgTable(
  "course_publications",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    publishedByUserId: text("published_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.courseId, table.revision],
      foreignColumns: [courseRevisions.courseId, courseRevisions.revision],
      name: "course_publications_course_revision_fk",
    }).onDelete("restrict"),
    index("course_publications_course_id_id_idx").on(table.courseId, table.id),
    index("course_publications_published_by_user_id_idx").on(
      table.publishedByUserId,
    ),
    check(
      "course_publications_revision_positive",
      sql`${table.revision} > 0`,
    ),
  ],
);

export const gameplayRuns = pgTable(
  "gameplay_runs",
  {
    id: uuid("id").primaryKey(),
    attribution: gameplayRunAttribution("attribution")
      .default("guest")
      .notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    courseId: text("course_id").notNull(),
    deploymentVersion: text("deployment_version").notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    loadedAt: timestamp("loaded_at", { mode: "date", withTimezone: true }),
    runtimeLoadTimeMs: integer("runtime_load_time_ms"),
    racingStartedAt: timestamp("racing_started_at", {
      mode: "date",
      withTimezone: true,
    }),
    endedAt: timestamp("ended_at", { mode: "date", withTimezone: true }),
    outcome: gameplayRunOutcome("outcome"),
    completedRaceTimeMs: integer("completed_race_time_ms"),
    inputFamilies: gameplayInputFamily("input_families").array().notNull(),
    recoveryCount: integer("recovery_count").default(0).notNull(),
    automaticPauseCount: integer("automatic_pause_count").default(0).notNull(),
    discardedTimeMs: integer("discarded_time_ms").default(0).notNull(),
    failureCode: text("failure_code"),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("gameplay_runs_started_at_idx").on(table.startedAt),
    check(
      "gameplay_runs_guest_has_no_user",
      sql`${table.attribution} <> 'guest' or ${table.userId} is null`,
    ),
    check(
      "gameplay_runs_course_id_length",
      sql`char_length(${table.courseId}) between 1 and 80`,
    ),
    check(
      "gameplay_runs_known_course",
      sql`${table.courseId} = 'rough-course'`,
    ),
    check(
      "gameplay_runs_deployment_version_length",
      sql`char_length(${table.deploymentVersion}) between 1 and 120`,
    ),
    check(
      "gameplay_runs_recovery_count_nonnegative",
      sql`${table.recoveryCount} >= 0`,
    ),
    check(
      "gameplay_runs_automatic_pause_count_bounded",
      sql`${table.automaticPauseCount} between 0 and 10000`,
    ),
    check(
      "gameplay_runs_discarded_time_ms_bounded",
      sql`${table.discardedTimeMs} between 0 and 86400000`,
    ),
    check(
      "gameplay_runs_completed_race_time_nonnegative",
      sql`${table.completedRaceTimeMs} is null or ${table.completedRaceTimeMs} >= 0`,
    ),
    check(
      "gameplay_runs_runtime_load_time_nonnegative",
      sql`${table.runtimeLoadTimeMs} is null or ${table.runtimeLoadTimeMs} >= 0`,
    ),
    check(
      "gameplay_runs_failure_code_length",
      sql`${table.failureCode} is null or char_length(${table.failureCode}) between 1 and 64`,
    ),
    check(
      "gameplay_runs_failure_code_allowlist",
      sql`${table.failureCode} is null or ${table.failureCode} in ('physics_load_failed', 'scene_initialization_failed', 'webgl_context_lost', 'webgl_context_restore_failed')`,
    ),
    check(
      "gameplay_runs_terminal_pair",
      sql`(${table.endedAt} is null and ${table.outcome} is null) or (${table.endedAt} is not null and ${table.outcome} is not null)`,
    ),
    check(
      "gameplay_runs_outcome_payload",
      sql`
        (${table.outcome} is null and ${table.completedRaceTimeMs} is null and ${table.failureCode} is null)
        or (${table.outcome} = 'completed' and ${table.completedRaceTimeMs} is not null and ${table.failureCode} is null)
        or (${table.outcome} = 'exited' and ${table.completedRaceTimeMs} is null and ${table.failureCode} is null)
        or (${table.outcome} in ('load_failed', 'runtime_failed') and ${table.completedRaceTimeMs} is null and ${table.failureCode} is not null)
      `,
    ),
    check(
      "gameplay_runs_milestone_order",
      sql`
        (${table.loadedAt} is null or ${table.loadedAt} >= ${table.startedAt})
        and (${table.racingStartedAt} is null or (${table.loadedAt} is not null and ${table.racingStartedAt} >= ${table.loadedAt}))
        and (${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt})
      `,
    ),
    check(
      "gameplay_runs_terminal_stage",
      sql`
        ${table.outcome} is null
        or ${table.outcome} = 'exited'
        or (${table.outcome} = 'completed' and ${table.racingStartedAt} is not null and ${table.endedAt} >= ${table.racingStartedAt})
        or (${table.outcome} = 'load_failed' and ${table.loadedAt} is null and ${table.racingStartedAt} is null)
        or (${table.outcome} = 'runtime_failed' and ${table.loadedAt} is not null and ${table.endedAt} >= ${table.loadedAt})
      `,
    ),
  ],
);

export const authSchema = {
  users,
  sessions,
  accounts,
  verifications,
};

export type ApplicationRole = (typeof applicationRole.enumValues)[number];
export type GameplayInputFamily =
  (typeof gameplayInputFamily.enumValues)[number];
export type GameplayRunOutcome =
  (typeof gameplayRunOutcome.enumValues)[number];
export type GameplayRunAttribution =
  (typeof gameplayRunAttribution.enumValues)[number];
