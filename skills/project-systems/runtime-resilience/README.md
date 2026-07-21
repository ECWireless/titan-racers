# Runtime Resilience System

## Status

**Maturity:** Validated. PR 2.5.2 passed focused runtime, browser, real-Postgres,
static, production-build, feature-lead QA, and independent-review gates on
2026-07-14.

## Purpose And Scope

This system implements the
[`runtime-resilience`](../../game-concepts/runtime-resilience/README.md)
standard through the
[`browser-playcanvas-runtime`](../../tools/browser-playcanvas-runtime/README.md)
mapping. It owns safe browser interruption, bounded overload behavior, canvas
resize reconciliation, loading exits, WebGL recovery presentation, and two
coarse run-health totals.

## Source Ownership

- `src/game/runtime/fixed-step-clock.ts` bounds accepted frame time, catch-up
  steps, and discarded active time.
- `src/game/runtime/playcanvas-application.ts` owns the custom animation loop,
  fixed-step pause/reset semantics, render suspension/restoration, and resize.
- `src/components/solo-time-trial-canvas.tsx` coordinates browser lifecycle,
  normalized input clearing, race pause/resume, loading and graphics recovery
  UI, race timing, and telemetry calls.
- `src/game/telemetry/gameplay-run-events.ts` owns bounded in-memory health
  totals and strict milestone payloads.
- `src/server/gameplay-telemetry-repository.ts`, `src/db/schema.ts`, and
  `drizzle/0010_runtime-health-summary.sql` own monotonic persistence and
  terminal immutability.
- `src/game/telemetry/gameplay-dashboard.ts` and the admin telemetry component
  own affected-run counts and median discarded time.

## Runtime Flow

1. A blur or hidden document clears every input adapter. If countdown, racing,
   or recovery is active, the race and fixed-step runtime pause once and the
   health summary increments once.
2. A hidden document queues a best-effort keepalive health milestone. Returning
   leaves the pause dialog visible until the player resumes explicitly.
3. Resize and orientation events call PlayCanvas canvas reconciliation without
   rebuilding the scene or race session.
4. Long active frames execute at most eight 120 Hz steps and accept at most
   100 ms before excess whole steps are discarded.
   Discarded time advances authoritative race timing and contributes only to the
   bounded per-run aggregate.
5. WebGL loss clears input, pauses gameplay, suspends rendering, and shows a
   restoring state. PlayCanvas rebuilds graphics resources. Restoration resizes
   and validates one render before returning to the pause dialog; a ten-second
   timeout or failed validation ends the run and offers reload or exit.

## Accepted Invariants

- No browser interruption automatically resumes driving.
- Background gaps cannot create physics catch-up bursts or race-time windfalls.
- Repeated blur/visibility signals while already paused do not increase the
  automatic-pause total.
- Graphics-context loss never leaves an apparently interactive frozen canvas.
- Resize does not reset kart, course, race, camera, or editor state.
- Runtime-health persistence is monotonic, bounded, idempotent, and contains no
  per-frame, viewport, hardware, driver, input, or movement data.
- Telemetry failure cannot block pause, resume, render recovery, racing, or exit.

## Verification

- `tests/playcanvas-runtime.spec.ts` covers fixed-step overload, pause-boundary
  reset, render suspension/restoration, and cleanup.
- `tests/gameplay-telemetry.spec.ts` covers strict health payloads, monotonic
  Postgres updates, terminal immutability, dashboard aggregation, hidden-page
  flushing, and transport independence.
- `tests/home.spec.ts` covers cancellable loading, controlled initialization
  failure, input cancellation, explicit pause/resume, resize preservation, and
  browser-driven WebGL loss/restoration.
- The complete matrix passed 329 tests and intentionally skipped 71
  project/environment-specific cases. Post-review focused telemetry/database
  verification passed 15 tests, and Home/WebGL/resize verification passed three.
- Typecheck, lint, migration history, production build, privacy review, PR 2.5.2
  technical review, and feature-lead QA passed.

## Known Limits

- Hidden-document and abrupt-exit telemetry delivery is best-effort.
- WebGL restoration depends on browser and driver support; reload remains the
  bounded fallback.
- Adaptive quality, detailed performance monitoring, crash reporting, and
  graphics-device diagnostics are intentionally outside Phase 2.
