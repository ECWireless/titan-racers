# Database And Authentication Operations

PR 3B uses Drizzle-managed Postgres migrations, Better Auth sessions, Google
OAuth identities, database-backed application roles, and immutable course
revisions. This document owns the operational workflow; it must not contain
real credentials, personal email addresses, or production connection strings.

## Local Postgres

Copy `.env.example` to the ignored `.env` file, then start the isolated local
database and apply every committed migration:

```bash
docker compose up -d postgres
corepack pnpm db:migrate
```

The repository container listens on `127.0.0.1:55432` to avoid colliding with
other local Postgres services. `DATABASE_MIGRATION_URL` may remain empty
locally; Drizzle then uses `DATABASE_URL`.

Generate migrations only while intentionally changing `src/db/schema.ts`:

```bash
corepack pnpm db:generate
corepack pnpm db:check
```

Generated SQL and Drizzle metadata are version-controlled and reviewed. Do not
use `drizzle-kit push` against shared or production databases.

Course publication adds an append-only `course_publications` table with a
database-level immutable trigger and a composite reference to an existing saved
course revision. Apply and rehearse that migration through the same reviewed
workflow; do not manually update publication history or simulate publishing by
changing draft rows.

PR 5A adds the typed `gameplay_runs` summary table through the same migration
workflow. Guest rows are anonymous and carry permanent guest attribution
separately from the nullable account foreign key. Database constraints and
triggers enforce known courses, valid lifecycle order, immutable attribution,
and frozen terminal summaries while still allowing an authenticated account
link to be erased on deletion. The table must never be populated with raw input,
per-frame movement, IP addresses, user agents, or arbitrary metadata. The
protected dashboard reads aggregates only; ordinary operators should not query
individual run IDs or add ad hoc identifying fields.

## Google OAuth

Create a Google OAuth web client and configure these redirect URIs:

- local: `http://localhost:3000/api/auth/callback/google`
- production: `https://play.titanracers.com/api/auth/callback/google`

Set `BETTER_AUTH_URL` to the matching origin and store the Google client ID,
client secret, Better Auth secret, and database URLs only in ignored local or
host-managed environment variables.

Titan Racers uses Google only to establish identity and does not call Google
APIs, so access, refresh, and ID tokens are discarded before account data is
stored. Account linking is also disabled until the explicitly deferred account-
linking phase. Only the original linked Google provider subject can resolve an
existing canonical application user.

PR 3B deliberately adds no login UI. For operational verification before PR 3C,
run this from the browser console on the same app origin so the OAuth state
cookie remains in that browser:

```js
const response = await fetch("/api/auth/sign-in/social", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ provider: "google", callbackURL: "/" }),
});
const { url } = await response.json();
location.assign(url);
```

## First Admin Bootstrap

Google login authenticates an identity but does not grant administrative
access. After the intended operator has completed Google login once, grant the
database-backed admin role from a trusted machine:

```bash
corepack pnpm db:bootstrap-admin --email operator@example.com
```

The email is used only to locate the canonical application user for this
credentialed operation. It is not an authorization allowlist, is not stored in
configuration, and must never be committed. There is no public role-promotion
endpoint.

## Identity Anonymization

Course revision attribution retains the opaque canonical application user ID,
but it must not make profile PII or provider credentials undeletable. From a
trusted machine, anonymize an account with:

```bash
corepack pnpm db:anonymize-user --email account@example.com
```

This transaction deletes sessions and linked provider accounts, removes
privileged roles, clears the profile image and verification state, and replaces
the name and email with non-personal tombstone values. The opaque user row and
baseline player role remain so immutable course revisions keep referential
integrity. The supplied email and real profile values are never written to
documentation or logs.

## Permanent Sandbox Course Reset

`rough-course` is the permanent authoring and regression sandbox. It remains
separate from the future official `agricultural-zone` course so editor, physics,
collision, camera, and recovery fixtures never need to be embedded in the
player-facing track.

From a trusted machine, restore the sandbox to the validated source-controlled
seed with an existing application admin identity:

```bash
corepack pnpm db:reset-sandbox-course \
  --email operator@example.com \
  --confirm rough-course
```

The explicit course-ID confirmation guards the destructive product intent. The
operation does not delete or rewrite immutable history: it validates the seed
and appends it as the next attributed draft revision using optimistic
concurrency. It fails if another author advances the sandbox during the reset.
The command uses `DATABASE_URL`, so confirm which database that variable targets
before running it. The supplied email is used only for the credentialed admin
lookup and is never logged or stored in configuration.

## Production Migration And Preview Policy

For the current early demo, the hosted preview may use the production Neon
database. This is a temporary feature-lead decision. There are no automated
Neon preview branches and no merge hook that mutates production.

Before applying a production migration:

1. apply it from scratch to local Postgres;
2. run the database integration tests and full verification suite;
3. review the generated SQL and confirm the exact commit being deployed;
4. confirm Neon recovery or point-in-time restore is available;
5. set `DATABASE_MIGRATION_URL` to a direct, non-pooled production connection;
6. run the migration once from the trusted development laptop:

```bash
corepack pnpm db:migrate:production
```

Deploy the matching application commit only after the migration succeeds, then
perform narrow production smoke checks. Do not experiment with unreviewed SQL,
run migrations during application startup, or treat production smoke testing
as a substitute for local migration and integration testing.

Application traffic uses the pooled Neon `DATABASE_URL`. The direct migration
credential should not be present in the application runtime when the hosting
platform can keep deployment credentials separate.

Ordinary `db:generate`, `db:check`, `db:migrate`, and sandbox-reset commands
intentionally read only `DATABASE_URL`; they never fall back to
`DATABASE_MIGRATION_URL`. The production credential is consumed only by the
explicitly named `db:migrate:production` script.
