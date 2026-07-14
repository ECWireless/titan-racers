# Gameplay Telemetry System

## Status

**Maturity:** Validated. PR 5A implementation passed focused pure, route,
real-Postgres, desktop, and mobile verification, production/static checks, two
independent review passes, and feature-lead gameplay/dashboard QA on 2026-07-14.

## Purpose And Scope

This system implements the minimal run-level standard in
[`game-concepts/gameplay-telemetry`](../../game-concepts/gameplay-telemetry/README.md)
through the browser and Postgres mapping in
[`tools/browser-postgres-telemetry`](../../tools/browser-postgres-telemetry/README.md).

It owns anonymous solo-run milestones, one summarized Postgres row per attempt,
protected operational aggregates, the `/admin/telemetry` dashboard, and
automatic Vercel page views. PR 5B will add bounded runtime-health totals and
failure recovery. This system does not own leaderboard results, ghosts,
anti-cheat, player history, raw physics diagnostics, or persistent guest
identity.

## Source Ownership

- `src/game/telemetry/gameplay-run-events.ts` defines the strict version-one
  semantic contract, non-blocking coordinator, and first-party HTTP sink.
- `src/app/api/telemetry/gameplay-runs/route.ts` owns the size-bounded,
  same-origin guest writer.
- `src/server/gameplay-telemetry-repository.ts` owns idempotent server-timestamped
  Postgres transitions and server-derived deployment attribution.
- `src/db/schema.ts` and `drizzle/0004_*` through `0008_*` own the typed run
  table, enum values, lifecycle and attribution constraints, triggers, and
  timestamp index.
- `src/game/telemetry/gameplay-dashboard.ts` owns pure aggregate semantics and
  the strict response contract.
- `src/server/gameplay-dashboard-repository.ts` loads only the selected summary
  columns and date range.
- `src/app/api/admin/telemetry/route.ts` enforces the database-backed admin role
  before returning aggregates.
- `src/components/admin/telemetry-dashboard-access.tsx` owns protected access,
  range selection, empty/populated states, operational summaries, and responsive
  presentation.
- `src/app/layout.tsx` mounts Vercel Web Analytics for automatic page views only.
- `src/components/solo-time-trial-canvas.tsx` emits existing race milestones,
  input-family activity, recovery count, terminal outcome, and allowlisted load
  failures without awaiting telemetry.

## Runtime Flow

1. Mounting a solo race generates one random UUIDv4 and queues `run_started`
   for the allowlisted playable course.
2. A ready PlayCanvas scene queues `runtime_loaded` with a bounded monotonic
   client load duration. The server records its own receipt timestamp and the
   duration separately so database/network latency does not inflate runtime
   loading time.
3. The first countdown-to-racing transition queues `race_started`.
4. Deliberate driving activity records a coarse set containing keyboard, touch,
   or gamepad; repeated activity and device switching add no event rows.
5. Accepted race recovery increments one in-memory counter.
6. Finish, explicit in-app exit, or allowlisted load failure queues one
   `run_ended` summary. A five-second transport timeout prevents one unavailable
   request from blocking later milestones. Terminal fetch uses `keepalive` but
   remains best-effort.
7. Postgres accepts safe duplicates, rejects invalid or conflicting lifecycle
   transitions, and leaves missing terminals open. The dashboard classifies
   recent open rows as active and rows older than 30 minutes as unfinished.

## Accepted Invariants

- A run UUID identifies one attempt and is never reused as a browser or player
  identity.
- Guest rows have immutable `guest` attribution and `user_id = null`. A future
  trusted server session may create a new `authenticated` run; account deletion
  may clear that row's user link without rewriting its historical attribution.
  Older guest runs can never be retroactively linked.
- Client JSON cannot provide user ID, timestamps, deployment version, arbitrary
  events, arbitrary metadata, URLs, exception messages, or stack traces.
- The database stores no IP address, user agent, referrer, raw control, kart
  transform, per-frame sample, or replayable activity timeline.
- Gameplay does not wait for or surface telemetry transport; unavailable
  telemetry cannot prevent loading, racing, restart, finish, or exit.
- The dashboard API returns funnel conversions, terminal-racing recovery
  samples, grouped bounded failures, and other aggregates—not run IDs or
  account IDs.
- Vercel receives automatic anonymous page views only; the first-party gameplay
  funnel is not duplicated as custom provider events.
- Automated browser runs disable real ingestion unless a focused test fixture
  opts in, preventing the local database from becoming test telemetry.

## Verification

- `tests/gameplay-telemetry.spec.ts` covers UUIDv4 and course allowlists,
  streaming request bounds, ordered non-blocking reporting, admin authorization,
  dashboard aggregation, idempotent and ordered real-Postgres transitions,
  immutable attribution and terminal outcome, account deletion, ingestion
  failure, and responsive dashboard rendering.
- `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, and the production build passed.
  The focused telemetry suite passed 21 tests with three intentional duplicate
  mobile database skips; the broader regression matrix had also passed before
  the final focused review corrections.
- Feature-lead QA accepted real local runs in the authenticated dashboard,
  range filtering without access-screen flicker, and desktop/narrow-screen
  usefulness.

## Known Limits And Deferred Work

- Explicit in-app exits are reported; abrupt browser or process shutdown remains
  best-effort and appears as unfinished after 30 minutes.
- Dashboard aggregation currently loads the selected run-summary window and
  aggregates in process. Move it into bounded SQL or rollups before volume makes
  that materially expensive.
- Infrastructure abuse controls are deployment concerns if public traffic shows
  need; same-origin checks alone do not stop a non-browser client from imitating
  an allowed request.
- PR 5B owns focus/visibility, resize, low-frame-rate, and WebGL/context failure
  policy plus their bounded summary fields.
