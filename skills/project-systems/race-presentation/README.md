# Race Presentation System

**Maturity:** Validated (PR 2.4.3, 2026-07-13).

## Purpose And Scope

This system combines the
[`race-presentation`](../../game-concepts/race-presentation/README.md) standard
with the
[`browser-race-presentation`](../../tools/browser-race-presentation/README.md)
mapping. It owns the rough-loop countdown, lap/time HUD, recovery announcement,
finish results, and replay presentation.

It does not own race authority, course geometry, persistence, leaderboards,
ghosts, telemetry, multiplayer, or final Agricultural Zone presentation.

## Source Ownership

- `src/game/race/race-presentation.ts` owns pure formatting, projection,
  meaningful announcements, lifecycle cues, and projection equality.
- `src/game/race/race-session.ts` owns the finished-to-countdown restart that
  clears timing, lap, progression, and recovery state.
- `src/components/solo-time-trial-canvas.tsx` publishes race projections at the
  runtime boundary, disables input at finish, renders the semantic HUD/dialog,
  and coordinates replay with kart/input/focus reset.
- `src/app/globals.css` owns safe-area-aware desktop, narrow mobile, compact
  landscape, high-contrast, and stable-numeral layout.
- `tests/race-presentation.spec.ts` and `tests/race-session.spec.ts` own pure
  projection/restart coverage.
- `tests/home.spec.ts` owns visible lifecycle, finish, controller replay, and
  350-pixel utility-clearance integration coverage.

## Runtime Flow

1. Fixed-step race logic updates the authoritative `RaceSession`.
2. A pure projector turns its defensive snapshot and progression result into
   plain display data.
3. Equality on displayed values suppresses redundant React updates.
4. Meaningful progression events remain projected until later meaningful
   progression replaces them, keeping live-region updates observable across
   fixed-step batching.
5. React renders persistent status, transient countdown/start/lap cues (resume
   countdowns reuse them), a
   nonvisual recovery announcement, or the finish dialog without feeding values
   back into gameplay.
6. Finish wins over a simultaneous pause edge, disables retained driving input,
   and focuses `Race again`.
7. Replay resets session, kart, velocities, camera/presentation discontinuity,
   input, progression samples, and focus before a new countdown.

## Accepted Invariants

- Formatted UI time is downstream from integer race microseconds.
- Live timer changes are never placed in the announcement string.
- Persistent progress is identical across input families.
- Recovery does not expose an internal lifecycle label as visual UI.
- Start and lap motion is decorative and disabled for reduced-motion users.
- The HUD cannot accept pointer input or obstruct touch controls.
- Finish input is semantic DOM focus; controller selection is not a parallel
  canvas state.
- Replay cannot retain completed laps, checkpoint anchors, velocities, or held
  input from the finished race.
- Bundled-coordinate browser fixtures cannot consume mutable publication data;
  publication behavior is covered through explicit route overrides.
- No race progress or result is persisted yet (Phase 5).

## Verification

- `tests/race-presentation.spec.ts` and `tests/race-session.spec.ts`: pure
  projection and restart.
- `tests/home.spec.ts`: two-race lifecycle with durable announcements,
  same-step pause/finish arbitration, controller finish focus, replay reset,
  held-input neutralization, and the 350 px mobile HUD.

## Known Limits And Deferred Work

- Real driving through every gate is not automated independently for keyboard,
  touch, and controller. Deterministic gate traversal, per-family driving/input
  integration, controller finish/replay/exit, and accepted feature-lead
  cross-device feel QA provide the current evidence boundary.
- Persistent results, ghosts, leaderboards, HUD settings, and audio cues are
  later work.
