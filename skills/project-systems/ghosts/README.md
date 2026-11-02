# Ghost System

**Maturity:** Candidate (PR 5.1).

## Purpose And Scope

How Titan Racers records races and replays your best as a ghost, following
the [ghost standard](../../game-concepts/ghosts/README.md). It owns the
recording format, the recorder, playback, the ghost kart's look, the
per-device best, and the Ghost switch.

A logged-in racer's best is stored and checked by the
[leaderboard](../leaderboard/README.md). Not supported yet: racing a stored
best or the course best, and shared ghost links.

## Source Ownership

- `src/game/ghost/ghost-trace.ts`: the versioned binary format (its layout
  is in the file's header comment), strict decoding, base64, and
  `GhostRecorder`.
- `src/game/ghost/ghost-playback.ts`: sampling a pose at a race time
  (time-scaled Hermite positions, shorter-arc rotation blend, reset holds).
- `src/game/ghost/ghost-kart-visual.ts`: the ghost kart, drawn from its own
  document through `createKartAssemblyVisual`.
- `src/game/ghost/device-ghost.ts`: the per-device best and the Ghost switch
  in `localStorage`.
- `src/components/solo-time-trial-canvas.tsx`: recording in the post-physics
  step, posing in the render loop, keeping a new best at finish, and the
  pause-menu switch (`src/components/setting-switch.tsx`).

## Behavior And Invariants

- The recorder samples every sixth 120 Hz step (20 Hz) while the race clock
  runs, plus both sides of each gate crossing and the first step after a
  reset. The recorded pose is the kart root (centre of mass, the point gates
  test) and the assembly rotation; a ghost's visual sits at
  `root + rotation × −centreOfMass` of its own kart.
- A new best is kept on finish and raced from the next Race again. Bests are
  keyed `titan-racers.ghost.v1:<course>:<revision or seed>:<physics>` and
  carry the kart document, centre of mass, and wheel stations, so another
  kart can be drawn. Every new best drops bests under other physics; one on a
  published revision also drops the seed's and earlier revisions'. A record
  this build cannot read or draw is ignored or forgotten, and the race runs
  without a ghost.
- The ghost is one unlit, dithered material in the site blue, in its own
  dynamic batch, with no shadows. It hides within a quarter of a kart length
  of the kart's root and shows again past 0.35 lengths. Race again with a
  new best of the same kart swaps only the path.
- `ghosts` is on only for home's solo race; the kart editor's test drive and
  the axis-ramp test have none. Run summaries record which ghost a race was
  set to race at its start ([telemetry](../gameplay-telemetry/README.md)).

## PlayCanvas Notes

- Tone mapping multiplies by the scene exposure, so the ghost's emissive
  intensity is `1 / exposure`; turning tone mapping off does not skip it.
- Dynamic batches draw copies of their materials
  ([scene lighting](../scene-lighting/README.md)), so the ghost fades through
  its batches' `meshInstance.visible`, looked up every frame, rather than its
  material. Toggling `enabled` rebuilds the batch, so it is kept for rare
  changes (finish, switch, Race again), and the pending rebuild runs at once
  (`batcher.updateAll()`) so a fade applies from the first frame.

## Verification

- `tests/ghost-trace.spec.ts`, `tests/ghost-playback.spec.ts`, and
  `tests/device-ghost.spec.ts`.
- `tests/home.spec.ts` two-lap lifecycle: the recording's gate samples and
  finish time, Race again installing the new best, hiding on the grid, and
  the switch hiding it while paused.

## Known Limits

- Both steered wheels take the centre steer angle, without Ackermann's
  spread, and a reversing ghost's wheels roll forward.
- The ghost's shader compiles the first time it is drawn, after it pulls
  clear early in the race, which may cost one long frame on a phone. Drawing
  it once behind the loading screen doubled every later frame's cost under
  software WebGL, so it is not warmed.
