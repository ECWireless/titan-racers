# Browser And Postgres Gameplay Telemetry

**Maturity:** Validated. This PR 2.5.1 mapping and PR 2.5.2's two bounded health totals
were accepted through implementation, focused browser and real-Postgres
verification, independent review, and feature-lead QA on 2026-07-14.

## Purpose And Scope

This node maps the engine-independent
[`gameplay-telemetry`](../../game-concepts/gameplay-telemetry/README.md)
standard to a browser client, Next.js route handlers, Postgres summaries, an
admin API, and Vercel page analytics.

## Browser Mapping

Generate a cryptographically random UUID for each run. Deliver small semantic
milestones with same-origin JSON `fetch`. Normal milestones may await a response
for tests and diagnostics, but gameplay never awaits them. A terminal update
during exit may use `fetch(..., { keepalive: true })`; the database contract must
still tolerate it never arriving.

Do not add `unload` or unconditional `beforeunload` analytics handlers. They are
unreliable on mobile and can interfere with the back/forward cache. PR 2.5.1 records
explicit in-app exits; PR 2.5.2 flushes the two bounded runtime-health totals when
the document becomes hidden as part of its broader visibility policy.

Keep the client reporter provider-neutral: gameplay emits versioned semantic
milestones to a small sink interface. The initial first-party HTTP sink is one
implementation. Vercel automatic page analytics is mounted separately and does
not receive gameplay milestones.

## Next.js Ingestion Mapping

- Require `application/json`, a direct allowed origin, and same-origin fetch
  metadata using the existing request guard.
- Stream request bodies through a byte counter, stop after the approved limit,
  and use a strict discriminated schema with UUIDv4 and known-course allowlists.
- Return success for safe duplicate delivery.
- Create only on `run_started`; later milestones update an existing UUID.
- Use database conditions so a terminal row cannot return to an earlier state
  or be ended twice with conflicting data.
- Derive received timestamps and deployment version on the server. Reserve
  account attribution for a server-validated session; never accept it in JSON.
- Return no stored record, user data, aggregates, or internal error detail to
  the guest writer.

## Postgres Mapping

Use one typed `gameplay_runs` row per attempt. Prefer explicit columns and enum
or check constraints over an arbitrary JSON property bag. Keep historical
guest/authenticated attribution separate from the erasable account foreign key.
Index the timestamp used by dashboard ranges and only add further indexes after
query evidence.

The read-only admin repository selects only bounded summary columns. It derives
conversion counts, input-family totals, recovery totals, daily trends, grouped
failures, and medians. PostgreSQL supports ordered-set `percentile_cont`, but a
small pure aggregation layer is acceptable for the initial bounded demo data
and is easier to exercise with deterministic dashboard fixtures. Revisit SQL
aggregation before unbounded production volume.

## Vercel Mapping

Mount `@vercel/analytics` version 2 at the root layout for automatic page views.
Use `beforeSend` to suppress or redact any future route containing identifiers.
The current public routes contain no player identifier. Do not send gameplay
custom events: Postgres owns that funnel, and duplicating it adds cost and a
second privacy surface without helping the approved dashboard.

Speed Insights is not part of PR 2.5.1. On Vercel Pro it currently has a separate
per-project monthly base fee and event charges; the approved runtime-health
questions are answered by bounded first-party run summaries instead.

## Verification

- Pure contract and aggregate tests run without a browser or database.
- Route tests cover origin/content-type/body-size/schema rejection and safe
  duplicate delivery.
- Real-Postgres tests inspect constraints, transitions, anonymous defaults, and
  protected aggregate results.
- Browser tests intercept or fail ingestion requests and prove the race loop is
  unaffected.
- Browser QA covers empty and populated admin dashboard states at desktop and
  narrow widths.
- The production build verifies that Vercel page analytics mounts without
  making local development or tests depend on provider availability.

## Primary Sources

- [MDN `Request.keepalive`](https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive)
- [MDN `Navigator.sendBeacon`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)
- [PostgreSQL aggregate functions](https://www.postgresql.org/docs/current/functions-aggregate.html)
- [PostgreSQL indexes](https://www.postgresql.org/docs/current/indexes.html)
- [Vercel Web Analytics package](https://vercel.com/docs/analytics/package)
- [Vercel Web Analytics privacy](https://vercel.com/docs/analytics/privacy-policy)

## Known Limits

- Same-origin browser guards reduce accidental cross-site writes but are not a
  substitute for infrastructure abuse controls. Rate limiting or bot controls
  should be added at the hosting boundary if public traffic demonstrates need.
- End-of-document terminal reporting remains best-effort.
- The initial in-process aggregation should move into bounded SQL or rollups if
  volume makes loading the selected date window materially expensive.
