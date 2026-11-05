import {
  bigint,
  boolean,
  check,
  customType,
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

import {
  MAX_RUN_SAMPLES,
  RUN_REJECTIONS,
} from "../game/race/race-verification";
import {
  ROOM_END_REASONS,
  ROOM_MAX_PLAYERS,
  ROOM_RACE_LIMIT_MS,
} from "../game/room/room-protocol";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    username: text("username"),
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
    anonymizedAt: timestamp("anonymized_at", {
      mode: "date",
      withTimezone: true,
    }),
    // Set by Better Auth for a racer started on one browser with no login
    // method; it records how the racer began and never changes.
    isAnonymous: boolean("is_anonymous").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("users_username_uidx").on(table.username),
    check(
      "users_username_format",
      sql`${table.username} is null or (${table.username} ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$' and ${table.username} !~ '__')`,
    ),
    check(
      "users_username_reserved",
      sql`${table.username} is null or (replace(${table.username}, '_', '') not in ('admin', 'administrator', 'deleted', 'moderator', 'official', 'racer', 'root', 'staff', 'support', 'system', 'titanracers') and replace(${table.username}, '_', '') not like '%titanracers%' and ${table.username} !~ '(^|_)(admin|administrator|moderator|official|root|staff|support|system|titan)($|_)')`,
    ),
  ],
);

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
    // A racer may link several wallets but only one Google account.
    uniqueIndex("accounts_one_google_per_user_uidx")
      .on(table.userId)
      .where(sql`${table.providerId} = 'google'`),
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

// Better Auth SIWE plugin rows. One racer per wallet address: the address is
// unique whatever chain the sign-in message names.
export const walletAddresses = pgTable(
  "wallet_addresses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("wallet_addresses_user_id_idx").on(table.userId),
    uniqueIndex("wallet_addresses_address_uidx").on(table.address),
  ],
);

// A racer's passkeys (WebAuthn credentials): a public key and its ID, no
// secret. A credential belongs to one racer.
export const passkeys = pgTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkeys_user_id_idx").on(table.userId),
    uniqueIndex("passkeys_credential_id_uidx").on(table.credentialID),
  ],
);

// Better Auth's request counts per client IP and path, shared by every
// server instance.
export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// A racer's earlier usernames, kept for them so a ghost link never passes to
// someone else. A merge adds the username of the racer it brought in.
export const racerFormerUsernames = pgTable(
  "racer_former_usernames",
  {
    username: text("username").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    retiredAt: timestamp("retired_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("racer_former_usernames_user_id_idx").on(table.userId)],
);

// One row per racer kept in one browser that was brought into another racer
// and deleted. It names only the racer that kept its history.
export const racerMerges = pgTable(
  "racer_merges",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // When the brought-in racer was started, for the dashboard's sign-ups.
    mergedRacerCreatedAt: timestamp("merged_racer_created_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    mergedAt: timestamp("merged_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("racer_merges_user_id_idx").on(table.userId)],
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

export const kartPublicationAction = pgEnum("kart_publication_action", [
  "publish",
  "unpublish",
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
    // Whether this publication started a new leaderboard; a course's first
    // always does. Otherwise its revision races on the board before it. The
    // publisher always sets it; the default is for builds that predate it.
    newLeaderboard: boolean("new_leaderboard").default(true).notNull(),
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

export const karts = pgTable(
  "karts",
  {
    id: text("id").primaryKey(),
    currentRevision: integer("current_revision").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("karts_owner_user_id_idx").on(table.ownerUserId),
    check("karts_current_revision_positive", sql`${table.currentRevision} > 0`),
  ],
);

export const kartRevisions = pgTable(
  "kart_revisions",
  {
    id: uuid("id").primaryKey(),
    kartId: text("kart_id")
      .notNull()
      .references(() => karts.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    derivationVersion: integer("derivation_version").notNull(),
    document: jsonb("document").notNull(),
    resolvedSnapshot: jsonb("resolved_snapshot").notNull(),
    resolvedSnapshotHash: text("resolved_snapshot_hash").notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("kart_revisions_kart_revision_uidx").on(
      table.kartId,
      table.revision,
    ),
    index("kart_revisions_author_user_id_idx").on(table.authorUserId),
    check("kart_revisions_revision_positive", sql`${table.revision} > 0`),
    check(
      "kart_revisions_schema_version_positive",
      sql`${table.schemaVersion} > 0`,
    ),
    check(
      "kart_revisions_derivation_version_positive",
      sql`${table.derivationVersion} > 0`,
    ),
    check(
      "kart_revisions_snapshot_hash_format",
      sql`${table.resolvedSnapshotHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const kartRevisionThumbnails = pgTable(
  "kart_revision_thumbnails",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => kartRevisions.id, { onDelete: "restrict" }),
    renderVersion: integer("render_version").notNull(),
    contentType: text("content_type").notNull(),
    imageData: bytea("image_data").notNull(),
    imageSha256: text("image_sha256").notNull(),
    generatedByUserId: text("generated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.renderVersion] }),
    index("kart_revision_thumbnails_generated_by_user_id_idx").on(
      table.generatedByUserId,
    ),
    check(
      "kart_revision_thumbnails_render_version_positive",
      sql`${table.renderVersion} > 0`,
    ),
    check(
      "kart_revision_thumbnails_content_type",
      sql`${table.contentType} = 'image/png'`,
    ),
    check(
      "kart_revision_thumbnails_image_size",
      sql`octet_length(${table.imageData}) between 1 and 524288`,
    ),
    check(
      "kart_revision_thumbnails_hash_format",
      sql`${table.imageSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const kartPublicationEvents = pgTable(
  "kart_publication_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    kartId: text("kart_id")
      .notNull()
      .references(() => karts.id, { onDelete: "restrict" }),
    action: kartPublicationAction("action").notNull(),
    revision: integer("revision"),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.kartId, table.revision],
      foreignColumns: [kartRevisions.kartId, kartRevisions.revision],
      name: "kart_publication_events_kart_revision_fk",
    }).onDelete("restrict"),
    index("kart_publication_events_kart_id_id_idx").on(table.kartId, table.id),
    index("kart_publication_events_actor_user_id_idx").on(table.actorUserId),
    check(
      "kart_publication_events_action_revision",
      sql`(${table.action} = 'publish' and ${table.revision} is not null and ${table.revision} > 0) or (${table.action} = 'unpublish' and ${table.revision} is null)`,
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
    // What the run raced (event version 3 on); a null revision is a
    // bundled seed or roster. Version 1 and 2 runs leave all four null.
    courseRevision: integer("course_revision"),
    kartId: text("kart_id"),
    kartRevision: integer("kart_revision"),
    raceAgain: boolean("race_again"),
    ghost: text("ghost"),
    // The finished result was shared (its link copied).
    shared: boolean("shared").default(false).notNull(),
    deploymentVersion: text("deployment_version").notNull(),
    physicsVersion: text("physics_version"),
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
      "gameplay_runs_race_identity",
      sql`(${table.courseRevision} is null or ${table.courseRevision} > 0)
        and (${table.kartRevision} is null or (${table.kartRevision} > 0 and ${table.kartId} is not null))
        and (${table.kartId} is null or char_length(${table.kartId}) between 1 and 80)
        and ((${table.kartId} is null) = (${table.raceAgain} is null))`,
    ),
    check(
      "gameplay_runs_ghost",
      sql`${table.ghost} is null or (${table.kartId} is not null and ${table.ghost} in ('none', 'own_best', 'course_best', 'shared_link', 'leaderboard_racer'))`,
    ),
    check(
      "gameplay_runs_shared_completed",
      sql`not ${table.shared} or ${table.outcome} is not distinct from 'completed'`,
    ),
    check(
      "gameplay_runs_deployment_version_length",
      sql`char_length(${table.deploymentVersion}) between 1 and 120`,
    ),
    check(
      "gameplay_runs_physics_version_length",
      sql`${table.physicsVersion} is null or char_length(${table.physicsVersion}) between 1 and 80`,
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

export const raceResultStatus = pgEnum("race_result_status", [
  "verified",
  "rejected",
]);

// A board runs from a publication that started a new leaderboard up to the
// next one, under one physics version, and is numbered per course.
export const leaderboards = pgTable(
  "leaderboards",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    courseId: text("course_id").notNull(),
    // The course's next number, set on insert by the leaderboards_number
    // trigger (drizzle/0025_*).
    number: integer("number")
      .notNull()
      .$defaultFn(() => sql`null`),
    // The revision whose publication started the board.
    courseRevision: integer("course_revision").notNull(),
    physicsVersion: text("physics_version").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("leaderboards_board_uidx").on(
      table.courseId,
      table.courseRevision,
      table.physicsVersion,
    ),
    uniqueIndex("leaderboards_number_uidx").on(table.courseId, table.number),
    check("leaderboards_number_positive", sql`${table.number} > 0`),
    foreignKey({
      columns: [table.courseId, table.courseRevision],
      foreignColumns: [courseRevisions.courseId, courseRevisions.revision],
      name: "leaderboards_course_revision_fk",
    }).onDelete("restrict"),
    check(
      "leaderboards_physics_version_length",
      sql`char_length(${table.physicsVersion}) between 1 and 80`,
    ),
  ],
);

// Every submitted run, keyed by its single-use ticket, verified or not.
export const raceResults = pgTable(
  "race_results",
  {
    id: uuid("id").primaryKey(),
    leaderboardId: integer("leaderboard_id")
      .notNull()
      .references(() => leaderboards.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kartId: text("kart_id").notNull(),
    kartRevision: integer("kart_revision").notNull(),
    status: raceResultStatus("status").notNull(),
    rejection: text("rejection"),
    timeMicroseconds: integer("time_microseconds"),
    ticketIssuedAt: timestamp("ticket_issued_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    submittedAt: timestamp("submitted_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    // A guest's run, sent once its racer signed in.
    claimed: boolean("claimed").default(false).notNull(),
  },
  (table) => [
    index("race_results_leaderboard_user_idx").on(
      table.leaderboardId,
      table.userId,
    ),
    check(
      "race_results_kart",
      sql`char_length(${table.kartId}) between 1 and 80 and ${table.kartRevision} > 0`,
    ),
    // Verified times are under the 15-minute race cap.
    check(
      "race_results_outcome",
      sql`(${table.status} = 'verified' and ${table.timeMicroseconds} is not null and ${table.timeMicroseconds} between 1 and 900000000 and ${table.rejection} is null)
        or (${table.status} = 'rejected' and ${table.timeMicroseconds} is null and ${table.rejection} is not null and ${table.rejection} in (${sql.raw(
          RUN_REJECTIONS.map((reason) => `'${reason}'`).join(", "),
        )}))`,
    ),
  ],
);

// Each player's best verified run on a board, with its ghost recording.
export const boardBests = pgTable(
  "board_bests",
  {
    leaderboardId: integer("leaderboard_id")
      .notNull()
      .references(() => leaderboards.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    resultId: uuid("result_id")
      .notNull()
      .references(() => raceResults.id, { onDelete: "restrict" }),
    timeMicroseconds: integer("time_microseconds").notNull(),
    ghost: bytea("ghost").notNull(),
    achievedAt: timestamp("achieved_at", { mode: "date", withTimezone: true })
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leaderboardId, table.userId] }),
    index("board_bests_rank_idx").on(
      table.leaderboardId,
      table.timeMicroseconds,
      table.achievedAt,
    ),
    // A header and one 24-byte sample, up to the run sample cap.
    check(
      "board_bests_ghost_size",
      sql`octet_length(${table.ghost}) between 32 and ${sql.raw(
        String(8 + 24 * MAX_RUN_SAMPLES),
      )}`,
    ),
  ],
);

export const roomRaceEndReason = pgEnum(
  "room_race_end_reason",
  ROOM_END_REASONS,
);

// A finished private-room race, reported by the room server. It names no
// account: rooms never send one, so merges and anonymization pass it by.
export const roomRaces = pgTable(
  "room_races",
  {
    id: uuid("id").primaryKey(),
    roomCode: text("room_code").notNull(),
    courseId: text("course_id").notNull(),
    courseRevision: integer("course_revision").notNull(),
    physicsVersion: text("physics_version").notNull(),
    racingAt: timestamp("racing_at", { mode: "date", withTimezone: true })
      .notNull(),
    endedAt: timestamp("ended_at", { mode: "date", withTimezone: true })
      .notNull(),
    endReason: roomRaceEndReason("end_reason").notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "room_races_course_revision_fk",
      columns: [table.courseId, table.courseRevision],
      foreignColumns: [courseRevisions.courseId, courseRevisions.revision],
    }).onDelete("restrict"),
    index("room_races_ended_at_idx").on(table.endedAt),
    check("room_races_room_code", sql`${table.roomCode} ~ '^[a-z2-9]{10}$'`),
    check(
      "room_races_physics_version",
      sql`char_length(${table.physicsVersion}) between 1 and 80`,
    ),
    check(
      "room_races_duration",
      sql`${table.endedAt} >= ${table.racingAt}`,
    ),
  ],
);

// Each racer's place, by kart. Who raced is never stored, only whether they
// were signed in.
export const roomRaceEntries = pgTable(
  "room_race_entries",
  {
    raceId: uuid("race_id")
      .notNull()
      .references(() => roomRaces.id, { onDelete: "restrict" }),
    place: integer("place").notNull(),
    kartId: text("kart_id").notNull(),
    kartRevision: integer("kart_revision").notNull(),
    // Null for a racer who did not finish.
    timeMicroseconds: integer("time_microseconds"),
    signedIn: boolean("signed_in").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.raceId, table.place] }),
    check(
      "room_race_entries_place",
      sql`${table.place} between 1 and ${sql.raw(String(ROOM_MAX_PLAYERS))}`,
    ),
    check(
      "room_race_entries_kart",
      sql`char_length(${table.kartId}) between 1 and 80 and ${table.kartRevision} > 0`,
    ),
    check(
      "room_race_entries_time",
      sql`${table.timeMicroseconds} is null or ${table.timeMicroseconds} between 1 and ${sql.raw(
        String(ROOM_RACE_LIMIT_MS * 1_000),
      )}`,
    ),
  ],
);

export const authSchema = {
  users,
  sessions,
  accounts,
  verifications,
  rateLimits,
  passkeys,
  // Better Auth pluralizes model names by appending "s".
  walletAddresss: walletAddresses,
};

export type ApplicationRole = (typeof applicationRole.enumValues)[number];
export type GameplayInputFamily =
  (typeof gameplayInputFamily.enumValues)[number];
export type GameplayRunOutcome =
  (typeof gameplayRunOutcome.enumValues)[number];
export type GameplayRunAttribution =
  (typeof gameplayRunAttribution.enumValues)[number];
export type KartPublicationAction =
  (typeof kartPublicationAction.enumValues)[number];
