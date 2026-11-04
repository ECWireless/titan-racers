# Gameplay Telemetry System

**Maturity:** Validated (PRs 2.5.1–2.5.2, 2026-07-14).

## Purpose And Scope

This system implements the minimal run-level standard in
[`game-concepts/gameplay-telemetry`](../../game-concepts/gameplay-telemetry/README.md)
through the browser and Postgres mapping in
[`tools/browser-postgres-telemetry`](../../tools/browser-postgres-telemetry/README.md).

It owns solo-run milestones, one summarized Postgres row per attempt (a
guest's, or a signed-in racer's), protected aggregates, the `/admin`
dashboard and the `/admin/telemetry` operational view, automatic Vercel page
views, and two bounded runtime-health totals. This system does not
own leaderboard results, ghosts,
anti-cheat, player history, raw physics diagnostics, or persistent guest
identity.

## Source Ownership

- `src/game/telemetry/gameplay-run-events.ts` defines the strict versioned
  semantic contract, non-blocking coordinator, and first-party HTTP sink.
- `src/app/api/telemetry/gameplay-runs/route.ts` owns the size-bounded,
  same-origin writer. On `run_started` only, it asks the trusted session
  (`signedInUserIdOrNull` in `src/server/session-user.ts`) for the racer; no
  session, or any failure, records a guest's run.
- `src/server/gameplay-telemetry-repository.ts` owns idempotent server-timestamped
  Postgres transitions and server-derived deployment attribution.
- `src/db/schema.ts` and `drizzle/0004_*` through `0019_*`, `0022_*`, and
  `0024_*` own the typed run table, enum values, lifecycle and attribution
  constraints, triggers, and timestamp index.
- `src/game/telemetry/gameplay-dashboard.ts` owns pure aggregate semantics and
  the strict response contract.
- `src/server/admin-overview-repository.ts` owns the `/admin` dashboard's SQL
  counts for the current solo course, by local calendar day (Monday weeks for
  all time), from `gameplay_runs`, `accounts` (sign-ups by each racer's first
  login method), and `race_results` (new bests in submission order).
  `loadRangeStart` starts 7- and 30-day ranges in the admin's IANA time zone
  (see [calendar-day trends](../../tools/browser-postgres-telemetry/README.md#postgres-mapping));
  the telemetry view shares it.
- `src/game/telemetry/admin-overview.ts` owns the dashboard's strict counts-only
  contract and time-zone parsing (IANA names only, never offsets).
- `src/server/gameplay-dashboard-repository.ts` loads only the selected summary
  columns and range for the operational view, so race times compare within
  one course.
- `src/app/api/admin/overview/route.ts` and `src/app/api/admin/telemetry/route.ts`
  enforce the database-backed admin role before returning aggregates; both
  take `range` and `tz`, and both answer `no-store`. Home's menu
  links `/admin` for admins, asking `GET /api/admin`, which says only whether
  the viewer is one.
- `src/components/admin/admin-overview.tsx` owns the dashboard: headline tiles,
  two column charts with tooltips and a table view, and the panels.
  `src/components/admin/telemetry-dashboard-access.tsx` owns the operational
  view. `src/components/admin/admin-access.tsx` owns what both share:
  protected access with sign-in that returns to the page, the icon
  navigation, and the range buttons; each page sends the browser's time zone.
- `src/app/layout.tsx` mounts Vercel Web Analytics for automatic page views only.
- `src/components/solo-time-trial-canvas.tsx` emits race milestones,
  input-family activity, recovery count, automatic safety pauses, aggregate
  discarded time, terminal outcome, and allowlisted failures without awaiting
  telemetry.

## Runtime Flow

1. Mounting a solo race, or Race again, generates one random UUIDv4 and
   queues `run_started` naming what the run races: the course and kart IDs,
   their publication revisions (null for a bundled seed or roster),
   whether it came from Race again, and which ghost it races (none, your own
   best, the course best, or a racer's best from a shared link or picked on
   the leaderboard). The server attributes it to the signed-in racer, if any.
2. A ready PlayCanvas scene queues `runtime_loaded` with a bounded monotonic
   client load duration. The server records its own receipt timestamp and the
   duration separately so database/network latency does not inflate runtime
   loading time.
3. The first countdown-to-racing transition queues `race_started`.
4. Deliberate driving activity records a coarse set containing keyboard, touch,
   or gamepad; repeated activity and device switching add no event rows.
5. Accepted race recovery increments one in-memory counter.
6. Automatic lifecycle pauses and fixed-step overload update two bounded
   in-memory totals. A hidden document queues their current monotonic summary.
7. Finish, explicit in-app exit, or allowlisted failure queues one
   `run_ended` summary. Copying a completed run's ghost link sends `run_shared`,
   which sets its `shared` flag once. A
   five-second transport timeout prevents one unavailable request from
   blocking later milestones. Terminal fetch uses `keepalive` but
   remains best-effort.
8. Postgres accepts safe duplicates, keeps runtime-health totals monotonic,
   rejects invalid or conflicting lifecycle
   transitions, and leaves missing terminals open. The dashboard classifies
   recent open rows as active and rows older than 30 minutes as unfinished.

New clients emit version-three events. A version-three start carries the
allowlisted client physics identity and the run's race identity. The server
stores it only when each named revision was published at some point (a race
outlives a later republish), or, for a null revision, when the ID is an
official bundled course or kart; anything else is ignored. A trigger keeps both
identities immutable. Version-one and version-two starts, which name a course
from a fixed list, remain accepted with null race identity; existing rows are
not backfilled. Deployment version remains server-derived. See [physics identity](../../../docs/kart-system/environment.md#shipped-physics-identity).

## Accepted Invariants

- A run UUID identifies one attempt and is never reused as a browser or player
  identity.
- Guest rows have immutable `guest` attribution and `user_id = null`. A start
  with a trusted server session creates an `authenticated` run with the
  racer's ID; a repeated start cannot relabel it. Account deletion clears
  the user link without rewriting the attribution, and anonymization keeps
  it under the opaque ID, as race results do. Older guest runs can never be
  retroactively linked, so runs before signed-in attribution all count as
  guests'.
- Client JSON cannot provide user ID, timestamps, deployment version, arbitrary
  events, arbitrary metadata, URLs, exception messages, or stack traces.
- The database stores no IP address, user agent, referrer, raw control, kart
  transform, per-frame sample, or replayable activity timeline.
- Runtime health contains no focus timestamps, viewport dimensions, device or
  graphics details, exception text, or stack traces.
- Gameplay does not wait for or surface telemetry transport; unavailable
  telemetry cannot prevent loading, racing, restart, finish, or exit.
- The dashboard APIs validate and return counts, funnel conversions,
  terminal-racing recovery samples, grouped allowlisted failures, and other
  aggregates, never run IDs, account IDs, usernames, or free-form failure
  text.
- Vercel receives automatic anonymous page views only; the first-party gameplay
  funnel is not duplicated as custom provider events.
- Automated browser runs disable real ingestion unless a focused test fixture
  opts in, preventing the local database from becoming test telemetry.

## Verification

- `tests/admin-overview.spec.ts` covers the dashboard's counts against real
  Postgres (local days and weeks, time zones with clock changes at midnight,
  new bests and ties, first login method), its route, and its page.
- `tests/gameplay-telemetry.spec.ts` covers UUIDv4, course allowlists and
  published race identity, session attribution,
  streaming request bounds, ordered non-blocking reporting, admin authorization,
  dashboard aggregation, idempotent and ordered real-Postgres transitions,
  immutable attribution and terminal outcome, account deletion, ingestion
  failure, and responsive dashboard rendering.
- `pnpm db:check` covers migrations.

## Known Limits And Deferred Work

- Explicit in-app exits are reported; abrupt browser or process shutdown remains
  best-effort and appears as unfinished after 30 minutes.
- The operational view loads the selected run-summary window and aggregates
  in process; the dashboard aggregates in SQL. Move the operational view into
  SQL or rollups before volume makes that materially expensive.
- Leaderboard ghost-link copies are not counted: only a finished run's copied
  link is.
- Infrastructure abuse controls are deployment concerns if public traffic shows
  need; same-origin checks alone do not stop a non-browser client from imitating
  an allowed request.
- Hidden-document health updates and abrupt terminal reporting remain
  best-effort; unfinished runs are not classified as crashes.
