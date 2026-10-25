# Race Progression System

**Maturity:** Validated (PR 2.4.2, 2026-07-13).

## Purpose And Scope

This node documents the implemented Titan Racers race-lifecycle and progression
system. It combines the engine-independent
[`race-progression`](../../game-concepts/race-progression/README.md) standard
with the PlayCanvas/Ammo mapping in
[`tools/playcanvas-ammo/race-progression`](../../tools/playcanvas-ammo/race-progression/README.md).

The system owns loading-through-finish lifecycle state, deterministic countdown
and race time, ordered directed checkpoints, lap completion, invalid-crossing
handling, pause/resume state, and safe checkpoint recovery. It does not own the
final integrated HUD, leaderboard persistence, analytics, ghosts, multiplayer,
or the final Falls View Park course.

## Source Ownership

- `src/game/race/race-gate.ts` owns the engine-independent swept directed-plane
  crossing test against an oriented bounded gate.
- `src/game/race/race-session.ts` owns lifecycle transitions, microsecond timing,
  expected-target progression, lap history, invalid-crossing diagnostics, and
  immutable recovery snapshots.
- `src/game/race/playcanvas-race-course.ts` converts validated course transforms
  into plain race gates and supplies the rough-loop configuration: a
  three-second countdown, two laps, and a half-second recovery stabilization.
- `src/game/course/course-document.ts` owns the canonical version-two start-gate,
  checkpoint direction, and recovery contract plus immutable version-one
  normalization. Candidate v2 directions are aligned to the full rotated gate
  face in memory so historical diagonal values remain playable.
- `src/game/course/rough-course.v5.json` owns the canonical rough-loop gate and
  recovery placements.
- `src/components/solo-time-trial-canvas.tsx` samples input, advances race time,
  evaluates post-physics kart movement, applies recovery transforms and velocity
  clearing, synchronizes camera/presentation discontinuities, and coordinates
  pause at a fixed-step boundary.
- `src/game/runtime/fixed-step-clock.ts` reports frame-local discarded time and
  supports an intentional stop after the current fixed step.
- `src/game/runtime/playcanvas-application.ts` exposes discarded-time listeners
  and boundary-safe pause without advancing hidden simulation steps.
- `src/game/testing/scene-test-adapter.ts` exposes copied race snapshots and
  semantic movement/recovery controls only in the non-production test boundary.
- `src/server/course-repository.ts` reports the normalized document schema
  version consistently while leaving historical stored revision JSON immutable.

## Runtime Flow

1. The published course is strictly parsed and normalized to an owned v2 value.
2. The PlayCanvas adapter builds the start/finish gate and ordered checkpoint
   gates as plain data; no rigid-body trigger entity is created.
3. The session moves from `loading` to `ready` and immediately begins
   `countdown`. Countdown time does not count toward the competitive result.
4. Before each 120 Hz physics step, input is sampled and race time advances.
   Driving is accepted only while the lifecycle is `racing`.
5. After Ammo advances, the session tests the authoritative previous-to-current
   kart-root segment against only the expected directed gate, while still
   diagnosing start, repeated, and out-of-order crossings.
6. Accepting a checkpoint advances the stable expected ID and promotes its
   authored transform to the active recovery anchor. Crossing start after the
   last checkpoint records a lap or atomically finishes the final lap; crossing
   it before the first checkpoint (leaving the spawn behind the gate) is
   neutral. Start recovery uses the spawn, not the gate.
7. Reset or fall recovery enters `recovering`, prefers the newest supported
   authored candidate while retaining an authored last resort, teleports the
   rigid body, clears linear and angular velocity, snaps presentation/camera
   state, clears input, and waits the configured stabilization duration before
   returning to `racing`.
8. Pause requests finish the current fixed step, capture the resumable lifecycle
   state, clear input, reset clock transport state, and stop simulation. A
   paused start countdown continues where it stopped; a paused race or recovery
   resumes through `resuming`, a 1.5 s countdown with physics frozen, driven by
   a canvas animation-frame loop.

## Accepted Behavior And Invariants

- Lifecycle state is one of `loading`, `ready`, `countdown`, `racing`, `paused`,
  `resuming`, `recovering`, or `finished`; unsupported transitions are inert.
- Competitive time is accumulated as integer microseconds with a retained
  sub-microsecond remainder. Countdown, ready/loading, pause, resuming, and
  finish do not add race time; recovery does.
- Capped frame time that the fixed-step clock discards is still charged to an
  active competitive timeline, so a stall cannot improve a result.
- Checkpoints are accepted only in contiguous authored order. Repeated,
  out-of-order, reverse, side-entry, finish-before-checkpoints, stationary, and
  lifecycle-inactive movement does not mutate progress or timing history.
- Swept segment/plane intersection prevents thin-gate tunneling. The crossing
  point must lie inside the full oriented checkpoint volume.
- A checkpoint's authored normalized direction identifies a rotated local axis
  and chooses its sign. Canonicalization snaps it to that full gate face,
  preventing diagonal planes from shrinking the valid off-center crossing area.
- At most one progression target is accepted per fixed step.
- The active recovery anchor changes only after a valid checkpoint or lap.
  Rejected progression never sends reset back to an older checkpoint.
- Recovery uses authored ground-level poses, verifies support candidates,
  preserves accepted checkpoint/lap history, and cannot manufacture a crossing
  because previous/current progression samples are reset together.
- Race snapshots and test diagnostics are defensive plain-data copies. Runtime
  PlayCanvas, Ammo, and mutable internal objects never cross the public or test
  contract.
- Race progress and per-frame kart paths are not persisted.

## Verification

Focused coverage includes:

- `tests/race-gate.spec.ts` for directed, reverse, side-entry, off-center,
  rotated, thin-gate, stationary, and non-finite movement;
- `tests/race-session.spec.ts` for lifecycle transitions, countdown/recovery
  boundaries, deterministic timing, laps, invalid ordering, pause, finish, and
  defensive snapshots;
- `tests/course-document.spec.ts` for v2 validation, canonical serialization,
  gate-face alignment, recovery data, and non-mutating v1/v2 compatibility;
- `tests/fixed-step-clock.spec.ts` and `tests/playcanvas-runtime.spec.ts` for
  discarded-time charging and fixed-step-boundary pause behavior;
- `tests/home.spec.ts` for the off-center two-lap route, latest-checkpoint reset,
  velocity clearing, recovery stabilization, pause/resume timing, dropped-time
  charging, and retained keyboard/touch/controller/runtime behavior; and
- editor and persistence tests for v2 authoring, publication, and immutable
  historical revision compatibility.

## Known Limits And Deferred Work

- Race results and progress are session-memory only; results, ghosts, and
  leaderboards arrive in Phase 5.
- The rough course is the development loop. Falls View Park shares its
  layout, gates, and recoveries; its own circuit will need its own
  placements and QA.
- Recovery support uses the accepted authored candidate chain and current
  PlayCanvas/Ammo raycast mapping; moving course geometry still requires
  course-specific clearance QA before publication.
