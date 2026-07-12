# Identity And Course Persistence System

## Status

**Maturity:** Candidate. PR 3B implementation, clean-database migration rehearsal,
focused auth/persistence integration tests, static checks, production build, and
the complete gameplay regression coverage pass as of 2026-07-12. Promote this
node to validated after the required independent reviews and feature-lead
acceptance.

## Purpose And Scope

This system owns canonical application identities, linked Better Auth provider
accounts, Postgres-backed sessions and roles, Google login, centralized
server-side admin authorization, immutable course revisions, and protected
course load/save APIs.

It keeps the portable course document defined by
[`course-data`](../course-data/README.md) free of database metadata. It adds no
login UI or visible editor behavior; those remain PR 3C work.

## Source Ownership

- `src/db/schema.ts` defines Better Auth tables, application roles, course heads,
  and immutable revision metadata.
- `drizzle/` contains the reviewed version-controlled Postgres migrations,
  including database triggers for default player roles and immutable revisions.
- `src/db/client.ts` owns the shared node-postgres pool and Drizzle client.
- `src/lib/auth.ts` configures Better Auth's Drizzle adapter and Google provider.
- `src/server/authorization.ts` validates live sessions and database roles at
  protected server boundaries.
- `src/server/course-repository.ts` validates portable documents and owns atomic
  revision creation, latest-revision loading, attribution, and optimistic
  concurrency.
- `src/app/api/auth/[...all]/route.ts` mounts Better Auth without adding UI.
- `src/app/api/admin/courses/[courseId]/route.ts` owns admin-only course load and
  save transport.
- `scripts/` and `docs/database-operations.md` own migration and first-admin
  operations.

## Identity And Authorization Flow

1. Google authenticates the external identity through Better Auth.
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

## Accepted Invariants

- Authentication proves identity; Postgres roles grant authority.
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
- Application traffic may use a pooled Neon connection; production migrations
  require the explicit direct migration URL and never run at app startup.

## Verification

- `tests/course-persistence.spec.ts` covers default roles, role denial and
  approval, real Better Auth sessions, protected API load/save, Google OAuth
  initiation, immutable attribution, and competing stale saves.
- `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` cover migration,
  static, and production-build boundaries.
- The production migration command is rehearsed from an empty Postgres database,
  and the created tables and triggers are inspected directly.
- The full desktop/mobile Playwright matrix remains the gameplay regression gate.

## Known Limits And Deferred Work

- PR 3C adds the visible login/access experience and protected course editor.
- Player-facing EOA/SIWE login, explicit account linking UI, and embedded wallets
  remain deferred.
- Automated Neon preview branches and production deployment migrations are not
  configured. Production migration is currently a deliberate laptop operation.
- The early hosted preview may share the production database by explicit
  feature-lead decision; local verification remains mandatory before migration.
