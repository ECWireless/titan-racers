# Gameplay Telemetry

**Maturity:** Validated. PR 5A implementation, database inspection, focused
desktop/mobile coverage, privacy/security and technical review, and feature-lead
dashboard QA were accepted on 2026-07-14.

## Purpose And Scope

This node defines the engine-independent standard for learning whether Titan
Racers gameplay runs load, begin, finish, exit, or fail without recording a
player's detailed behavior. Read it before adding product analytics, gameplay
milestones, run summaries, operational dashboards, or account attribution to
telemetry.

It does not define browser transport, Postgres tables, Vercel APIs, runtime
failure recovery, leaderboard eligibility, anti-cheat, or player history.
Tool-specific mapping belongs under [`../../tools/`](../../tools/README.md), and
accepted repository ownership belongs under
[`../../project-systems/`](../../project-systems/README.md).

## Standard

Collect the smallest run-level summary that answers an agreed product or
operational question. Model one race attempt with one opaque random run ID and
idempotent milestones rather than a general event stream. Store coarse totals
and terminal outcome, never per-frame samples, raw input, kart paths, replayable
timelines, precise hardware identity, IP address, user agent, referrer, or a
persistent anonymous browser identity.

The initial dashboard should answer only:

1. How many solo runs were attempted?
2. How many loaded, reached active racing, and completed?
3. How long did loading and completed racing usually take?
4. Which supported input families and recovery behavior were represented?
5. Which bounded failure categories or unfinished runs need investigation?

## Run Identity And Future Accounts

A random UUIDv4 run ID identifies one attempt, not one person, browser, device,
or auth session. Guest runs have immutable guest attribution and no user ID. A
future authenticated run may receive the canonical application user ID only
from the trusted server session; the client never supplies it. Deleting that
account may clear the erasable user link without rewriting the historical
attribution category. Never retroactively attach older anonymous runs to a
player who later signs in.

This produces three unambiguous query populations: all runs, anonymous runs,
and runs that were authenticated when recorded. Individual player-history
surfaces, deletion policy, leaderboard eligibility, and account analytics
remain separate product decisions.

## Milestones And Summary

The initial semantic contract is versioned and bounded:

- `run_started`: one solo attempt was created for a known course;
- `runtime_loaded`: the playable runtime reached its ready boundary;
- `race_started`: countdown completed and competitive racing began; and
- `run_ended`: the run completed, exited, or failed with an allowlisted outcome
  and final coarse counters.

Milestones update one run summary idempotently. Duplicates, retries, and
out-of-order updates cannot create extra attempts or overwrite a terminal
outcome. A recent open run may still be active; an old open run is reported as
unfinished. End-of-page delivery is best-effort, so missing terminal updates are
an expected measurement limitation rather than proof of a crash.

Useful initial summary fields are course, deployment version, milestone times,
terminal outcome, completed race duration, supported input-family set, and
recovery count. PR 5B may add bounded runtime-health totals only when each field
drives an agreed dashboard question.

## Privacy And Security Rules

- Accept only a strict, versioned, size-bounded contract.
- Derive server-owned time, deployment version, and future user attribution on
  the server.
- Do not accept arbitrary event names, property bags, URLs, exception messages,
  stack traces, or free-form client metadata.
- Protect read access with the existing authoritative admin role.
- Keep guest ingestion non-blocking and failure-tolerant; racing must not depend
  on telemetry availability.
- Do not expose opaque run IDs in the normal dashboard unless a concrete
  debugging workflow later requires them.
- Treat analytics-provider page data as a separate aggregate surface; do not
  duplicate the gameplay funnel into third-party custom events by default.

## Failure Modes

- A generic event table invites unreviewed fields and makes privacy boundaries
  depend on caller discipline.
- One persistent anonymous ID silently becomes cross-session tracking.
- Client-provided user IDs, timestamps, or deployment labels corrupt trust and
  attribution.
- Per-frame performance, input, or transform capture produces high-volume,
  replayable behavioral data without answering the initial questions better.
- Treating every missing end event as a crash overstates failures because
  browsers cannot guarantee exit delivery.
- Building live updates, arbitrary queries, exports, or a charting platform
  before the core questions are proven creates operational surface without
  product value.

## Validation

1. Contract tests reject unknown fields, invalid transitions, non-finite or
   unbounded counters, arbitrary failures, and malformed run IDs.
2. Real-Postgres tests prove idempotent creation, milestone progression,
   immutable terminal outcomes, server-owned fields, and anonymous defaults.
3. Authorization tests prove only database-backed admins can read aggregates.
4. Dashboard fixtures prove empty, active, unfinished, completed, exited, and
   failed populations remain distinguishable.
5. Browser tests prove telemetry failure never blocks loading, racing, exiting,
   restarting, or finishing.
6. Privacy review inspects the schema, payloads, responses, logs, page analytics,
   and rendered dashboard for unnecessary identifying or replayable data.

## Tool Mapping

- [`../../tools/browser-postgres-telemetry/`](../../tools/browser-postgres-telemetry/README.md)
  maps this standard to the browser lifecycle, Next.js handlers, Postgres, and
  Vercel Web Analytics.

## Primary Sources

- [MDN `Request.keepalive`](https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive)
  describes best-effort fetch completion during document teardown.
- [MDN `Navigator.sendBeacon`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)
  documents lifecycle reliability limits and recommends visibility changes over
  unload handlers.
- [Vercel Web Analytics privacy](https://vercel.com/docs/analytics/privacy-policy)
  documents aggregate collection and the need to redact sensitive URLs or
  custom properties.

## Known Limits

- Exit and abrupt-close totals are approximate because no browser lifecycle
  transport guarantees a terminal request.
- The initial dashboard is an operational learning surface, not a product
  analytics warehouse or player history.
- Retention and authenticated player-facing data rights must be agreed before
  telemetry is used beyond this bounded demo-learning purpose.
