# Identity And Course Persistence System

## Status

**Maturity:** Validated. PR 3B implementation, clean-database migration
rehearsal, focused auth/persistence integration tests, static checks,
production build, complete gameplay regression coverage, independent review,
and feature-lead acceptance are complete.

## Purpose And Scope

This system owns canonical application identities, linked Better Auth provider
accounts, Postgres-backed sessions and roles, Google login, centralized
server-side admin authorization, immutable course revisions, and protected
course load/save APIs.

It keeps the portable course document defined by
[`course-data`](../course-data/README.md) free of database metadata. The visible
login and authoring experience belongs to the completed protected
[`course-editor`](../course-editor/README.md) system.

## Source Ownership

- `src/db/schema.ts` defines Better Auth tables, application roles, course heads,
  immutable revision metadata, and append-only attributed publications.
- `drizzle/` contains the reviewed version-controlled Postgres migrations,
  including database triggers for default player roles and immutable revisions.
- `src/db/client.ts` owns the shared node-postgres pool and Drizzle client.
- `src/lib/auth.ts` configures Better Auth's Drizzle adapter and Google provider,
  including an explicit Google account-selection prompt for every sign-in.
- `src/server/authorization.ts` validates live sessions and database roles at
  protected server boundaries.
- `src/server/request-guards.ts` enforces strict JSON and same-origin browser
  boundaries for custom authenticated mutations.
- `src/server/course-repository.ts` validates portable documents and owns atomic
  revision creation, latest-revision and publication loading, publication
  attribution, and optimistic concurrency.
- `src/app/api/auth/[...all]/route.ts` mounts Better Auth without adding UI.
- `src/app/api/admin/courses/[courseId]/route.ts` owns admin-only course load and
  save transport.
- `src/app/api/admin/courses/[courseId]/publication/route.ts` owns admin-only
  publication status and mutation; `src/app/api/courses/[courseId]/published`
  exposes only the validated runtime document and non-personal revision timing.
- `scripts/` and `docs/database-operations.md` own migration, first-admin,
  anonymization, and guarded sandbox-reset operations.

## Identity And Authorization Flow

1. Better Auth sends Google `prompt=select_account`, so every sign-in asks the
   player to choose an identity instead of silently reusing the browser's active
   Google account. Google then authenticates the selected external identity.
2. Better Auth creates or resolves a canonical `users.id` and linked `accounts`
   row; provider IDs never replace the application user ID. Google token
   material is discarded because the application does not call Google APIs.
3. A database trigger grants every new user the baseline `player` role in the
   same database transaction.
4. The credentialed bootstrap script may grant `admin` only to an existing
   Google-linked application user. There is no public promotion endpoint.
5. Protected handlers validate the signed session against Postgres, then query
   `user_roles`. Client visibility and cookie existence are never authoritative.
6. Account linking is disabled. A new provider subject cannot inherit an
   existing canonical identity or its roles by presenting the same email.

## Course Revision Flow

1. Every API or repository save validates the complete input through the
   existing strict course-document schema.
2. A new course begins at revision one only when the expected revision is null.
3. Existing saves atomically advance the mutable course head only when its
   revision equals the caller's expected revision.
4. The complete portable document is inserted as JSONB with schema version,
   canonical author ID, and creation time.
5. A database trigger rejects update or delete operations on revision rows.
6. Competing stale saves return a conflict and never overwrite the winning
   revision.

## Course Publication Flow

1. An admin may publish only a revision already stored for the requested course.
2. The repository locks the course row, compares the expected latest publication
   ID, and inserts one attributed publication event; competing publishers cannot
   both advance the publication head from the same base.
3. Publication rows are immutable at the database boundary. Republishing the
   already-current revision is idempotent and does not create history noise.
4. Protected responses retain opaque attribution for audit. The unauthenticated
   runtime response omits author, publisher, and internal publication IDs.
5. Guest racing selects an explicit course ID and consumes only its newest
   publication. When persistence is unavailable or no publication exists, the
   current demo may fall back to the validated bundled sandbox seed so guest play
   remains available; it never consumes an unpublished database draft.

## Accepted Invariants

- Authentication proves identity; Postgres roles grant authority.
- Google sign-in always presents explicit account selection. A forbidden editor
  session is signed out before another OAuth attempt begins, so switching
  identities cannot be mistaken for account linking.
- Custom protected course mutations accept only `application/json` from the
  direct request origin or configured canonical application/auth origins, so
  reverse-proxied same-origin traffic remains valid. Foreign or missing origins,
  cross-site fetch metadata, and simple form-compatible content types are
  rejected before request parsing.
- Email is only a credentialed bootstrap lookup and never a durable admin
  allowlist.
- Guest racing and the existing product UI do not require a database session.
- Secrets and connection strings remain outside version control.
- OAuth provider token material is not retained in Postgres.
- Anonymization removes sessions, provider credentials, privileged roles, and
  profile PII while retaining only the opaque user ID needed for attribution.
- Course documents contain no revision IDs, author IDs, timestamps, or other
  database metadata.
- Revisions are append-only and fully attributed.
- Publications are append-only, fully attributed, concurrency-safe pointers to
  immutable saved revisions.
- `rough-course` is a permanent sandbox course. Resetting it appends the
  validated source-controlled seed as a new attributed revision and never
  deletes history; the official Agricultural Zone uses the separate stable ID
  `agricultural-zone`.
- Application traffic may use a pooled Neon connection; production migrations
  require the explicit direct migration URL and never run at app startup.

## Verification

- `tests/auth-configuration.spec.ts` covers the environment-independent Google
  account-selection policy.
- `tests/course-persistence.spec.ts` covers default roles, role denial and
  approval, real Better Auth sessions, protected API load/save, Google OAuth
  initiation including the generated account-selection parameter, immutable
  attribution, and competing stale saves.
- `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` cover migration,
  static, and production-build boundaries.
- The production migration command is rehearsed from an empty Postgres database,
  and the created tables and triggers are inspected directly.
- The full desktop/mobile Playwright matrix remains the gameplay regression gate.

## Primary Reference

- [Better Auth Google provider: Always ask to select an account](https://better-auth.com/docs/authentication/google#always-ask-to-select-an-account)
  defines the server-side `prompt: "select_account"` configuration used here.

## Known Limits And Deferred Work

- The visible login/access experience and protected course editor are owned by
  the completed PR 3C course-editor system.
- Player-facing EOA/SIWE login, explicit account linking UI, and embedded wallets
  remain deferred.
- Automated Neon preview branches and production deployment migrations are not
  configured. Production migration is currently a deliberate laptop operation.
- The early hosted preview may share the production database by explicit
  feature-lead decision; local verification remains mandatory before migration.
