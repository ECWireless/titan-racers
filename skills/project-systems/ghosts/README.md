# Ghost System

**Maturity:** Validated (PRs 5.1–5.5, 2026-11-03).

## Purpose And Scope

How Titan Racers records races and replays your best as a ghost, following
the [ghost standard](../../game-concepts/ghosts/README.md). It owns the
recording format, the recorder, playback, the ghost kart's look, the
per-device best, which ghost a race takes, and the Ghost switch.

A logged-in racer's best is stored and checked by the
[leaderboard](../leaderboard/README.md).

## Source Ownership

- `src/game/ghost/ghost-trace.ts`: the versioned binary format (its layout
  is in the file's header comment), strict decoding, base64, and
  `GhostRecorder`.
- `src/game/ghost/ghost-playback.ts`: sampling a pose at a race time
  (time-scaled Hermite positions, shorter-arc rotation blend, reset holds).
- `src/game/ghost/ghost-kart-visual.ts`: the ghost kart, drawn from its own
  document through `createKartAssemblyVisual`.
- `src/game/ghost/device-ghost.ts`: the per-device best, the ghost choice,
  and the Ghost switch in `localStorage` (with a subscription, so home's No
  ghost choice and the pause-menu switch stay in step), and reading a ghost
  record.
- `src/game/ghost/board-ghost.ts`: fetching the board's course best, your
  account best, or a named racer's best
  (`GET /api/leaderboards/[courseId]/ghost`).
- `src/components/play-home.tsx`: the mode step's ghost choice (a ghost
  link's racer, Course best, Your best, or No ghost, which is the Ghost
  switch), and loading the board's ghost before a solo race mounts.
- A ghost link's preview belongs to
  [`leaderboard`](../leaderboard/README.md).
- `src/lib/share-link.ts`: ghost link URLs and copying them, for the
  result screen's Copy link and the leaderboard rows'.
- `src/components/solo-time-trial-canvas.tsx`: recording in the post-physics
  step, posing in the render loop, keeping a new best at finish, and the
  pause-menu switch (`src/components/setting-switch.tsx`).

## Behavior And Invariants

- The recorder samples every sixth 120 Hz step (20 Hz) while the race clock
  runs, plus both sides of each gate crossing and the first step after a
  reset. The recorded pose is the kart root (centre of mass, the point gates
  test) and the assembly rotation; a ghost's visual sits at
  `root + rotation × −centreOfMass` of its own kart.
- A solo race on a board takes the course best by default, or your account
  best if you choose your own. Without one (an empty board, a guest, a failed
  request, or a kart this build cannot draw) it races your best on this
  device. A board ghost is a record like a device best, built on the server
  from the best's recording and its kart revision.
- A ghost link, `/?ghost=<username>`, names a racer by their exact public
  username, never an ID, and races their best on the course's current board
  when opened, so it follows their improvements. Home offers it first in the
  Ghost choice for that visit, and it shows even with the Ghost switch off.
  A leaderboard row's Race button adds `&from=leaderboard`, a separate ghost
  kind in run summaries, and opens home at the kart step.
- A run faster than the ghost raced is raced from the next Race again; the
  device keeps its own best whichever ghost was raced. Bests are
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
  finish time, Race again installing the new best, hiding on the grid, the
  switch hiding it while paused, and a ghost link's racer; sharing a new
  best's ghost link.
- `tests/race-results.spec.ts` and `tests/leaderboard.spec.ts`: finding a
  racer's best by username, and each row's Race and Copy link.

## Known Limits

- Both steered wheels take the centre steer angle, without Ackermann's
  spread, and a reversing ghost's wheels roll forward.
- The ghost's shader compiles the first time it is drawn, after it pulls
  clear early in the race, which may cost one long frame on a phone.
