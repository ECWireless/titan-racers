# Database And Authentication Operations

PR 2.3.2 uses Drizzle-managed Postgres migrations, Better Auth sessions, Google
OAuth identities, database-backed application roles, and immutable course
revisions. PR 3.2 adds immutable kart revisions through the same foundation.
This document owns the operational workflow; it must not contain real
credentials, personal email addresses, or production connection strings.

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

PR 3.2 kart persistence adds player-owned `karts`, immutable `kart_revisions`, and
append-only `kart_publication_events`. The application derives and hashes the
physical snapshot before inserting a revision; operators must not manually edit
source documents, resolved evidence, hashes, or publication history. Rehearse
the complete migration chain against a fresh local database because the kart
publication foreign key depends on the composite revision key created in the
same migration.

PR 3.5 adds `kart_revision_thumbnails` as an immutable one-to-one attachment to
an existing kart revision. Each row contains one bounded PNG, its SHA-256 hash,
the renderer version, and opaque generator attribution. Public delivery still
resolves the current publication before loading an image; operators must not
copy thumbnails between revisions, replace stored bytes, or infer publication
from the presence of an image. Apply the migration before deploying code that
captures thumbnails. Existing revisions remain valid and use exact local
rendering until a later save or an explicit future backfill creates an image.

PR 4.1.3 (`0014`) keys thumbnails by revision and renderer version, so a
renderer change adds an image beside the older ones instead of replacing them.
Rows stay append-only, and only the current renderer version is served. After
migrating and deploying a renderer change, open `/admin/karts` once as an
admin: it captures any missing current-version images for each official kart's
latest and published revisions. `0014` is roll-forward only: code from before
it looks up thumbnails by revision alone and could serve an older render.

PR 2.5.1 adds the typed `gameplay_runs` summary table through the same migration
workflow. Guest rows are anonymous and carry permanent guest attribution
separately from the nullable account foreign key. Database constraints and
triggers enforce known courses, valid lifecycle order, immutable attribution,
and frozen terminal summaries while still allowing an authenticated account
link to be erased on deletion. The table must never be populated with raw input,
per-frame movement, IP addresses, user agents, or arbitrary metadata. The
protected dashboard reads aggregates only; ordinary operators should not query
individual run IDs or add ad hoc identifying fields.

PR 2.5.2 adds two bounded nonnegative totals to that same row:
`automatic_pause_count` and `discarded_time_ms`. Hidden-document and terminal
updates only increase those totals, and the terminal immutability trigger covers
both columns. They answer whether active runs needed browser-lifecycle safety
pauses and whether the fixed-step overload guard discarded active simulation
time. Do not derive or add frame timelines, viewport dimensions, device or GPU
details, exception text, or stack traces.

Migration `0015` adds nullable `gameplay_runs.physics_version` with an immutable
update guard. Existing rows remain null; version-one client starts also insert
null. New starts pin the allowlisted client physics version. Apply the additive
migration before deploying the versioned writer. This does not rewrite course
revisions: adopting the v3 sandbox seed separately appends a new rough-course
draft through the guarded seed reset, which an admin then publishes.

Migration `0016` widens the known-course check on `gameplay_runs.course_id`
to the official courses, `rough-course` and `agricultural-zone`. Existing rows
already satisfy it. Apply it before deploying the build that races
`agricultural-zone`, or the database rejects those runs' telemetry (racing is
unaffected). It is forward-only: restoring the old check first requires
removing or remapping `agricultural-zone` rows.

Migration `0017` adds `falls-view-park`, the time trial's ID from PR 4.3.4,
to that check and keeps `agricultural-zone`: earlier runs keep their ID, and
clients still on the older build keep sending it. Apply it before deploying
the build that races `falls-view-park`. The new ID starts with no saved
revision, so players race its bundled seed until an admin opens it from the
course roster, selects **Initialize seed course**, and publishes it. Any
`agricultural-zone` revisions and runs stay as history, but the editor no
longer lists the course and the telemetry dashboard shows only
`falls-view-park` runs. Rolling the code back is safe, since the check only
widened; restoring the `0016` check first requires removing or remapping
`falls-view-park` rows.

Courses are saved as schema version six (indoor and overhead objects, tunnel
lamps, and smooth arcs, from PR 4.4.2); earlier rows load unchanged, with no
migration. A build from before a course's version cannot read it: rolling the
code back after a save breaks the editor and the published-course route for
that course, though players fall back to the bundled course. That holds for
version six (before PR 4.4.2), version five (course lamps and mirror angles
up to 90°, before PR 4.3.5), and more than four lamps (before PR 4.4.1). A
database
serves its existing `rough-course` revision, not the walled Starter Course
seed, until the guarded seed reset below appends the seed and an admin
publishes it.

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

PR 2.3.2 deliberately adds no login UI. For operational verification before
PR 2.3.3,
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

Course and kart revision attribution retain the opaque canonical application
user ID, but it must not make profile PII or provider credentials undeletable.
From a trusted machine, anonymize an account with:

```bash
corepack pnpm db:anonymize-user --email account@example.com
```

This transaction deletes sessions and linked provider accounts, removes
privileged roles, clears the profile image and verification state, and replaces
the name and email with non-personal tombstone values. The opaque user row and
baseline player role remain so immutable course revisions keep referential
integrity. The supplied email and real profile values are never written to
documentation or logs.

## Official Course Seed Reset

`rough-course` is the permanent authoring and regression sandbox. It remains
separate from the official `falls-view-park` course so editor, physics,
collision, camera, and recovery fixtures never need to be embedded in the
player-facing track.

From a trusted machine, restore either official course to its validated
source-controlled seed with an existing application admin identity:

```bash
corepack pnpm db:reset-course-seed \
  --email operator@example.com \
  --confirm falls-view-park # or rough-course
```

The explicit course-ID confirmation guards the destructive product intent. The
operation does not delete or rewrite immutable history: it validates the seed
and appends it as the next attributed draft revision using optimistic
concurrency. It fails if another author advances the course during the reset.
Players keep racing the current publication until an admin opens the course
in the editor and publishes the new draft. The seed comes from the local
checkout, so run the command from the deployed commit (normally `main`), and
deploy a build that changes a seed's schema before resetting to it. The
command uses `DATABASE_URL`, so confirm which database that variable targets
before running it. The supplied email is used only for the
credentialed admin lookup and is never logged or stored in configuration.

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

Ordinary `db:generate`, `db:check`, `db:migrate`, and `db:reset-course-seed`
commands intentionally read only `DATABASE_URL`; they never fall back to
`DATABASE_MIGRATION_URL`. The production credential is consumed only by the
explicitly named `db:migrate:production` script.
