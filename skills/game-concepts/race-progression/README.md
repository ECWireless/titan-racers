# Race Lifecycle And Progression

**Maturity:** Validated (PR 2.4.2, 2026-07-13).

## Purpose And Scope

This node defines the Titan Racers standard for race lifecycle, ordered
checkpoint and lap progression, deterministic timing, invalid-progression
handling, and checkpoint recovery. Read it before changing race states,
countdowns, pause semantics, checkpoint crossing, lap completion, finish
results, reset policy, or race-time accounting.

It does not own device bindings, kart forces, final HUD presentation, database
results, telemetry persistence, ghosts, leaderboards, multiplayer authority, or
a particular engine query API. Player input supplies normalized action state
and reset/pause edges. Engine mapping lives in
[`tools/playcanvas-ammo/race-progression`](../../tools/playcanvas-ammo/race-progression/README.md);
the shipped system lives in
[`project-systems/race-progression`](../../project-systems/race-progression/README.md).

## Standard

Own the race as one explicit finite-state machine and one engine-independent
progression model. Consume normalized player requests and fixed-step kart poses
through narrow commands. Do not let React presentation, input adapters,
PlayCanvas entities, physics callbacks, or wall-clock reads become alternative
race authorities.

Evaluate checkpoint crossing and lifecycle countdown/recovery boundaries at the
fixed simulation boundary. Keep display formatting downstream of authoritative
time and progression snapshots.

## Desired Outcome

- Loading, ready, countdown, racing, paused, recovering, and finished behavior
  is mutually exclusive and testable.
- A race starts, pauses, recovers, resumes, advances laps, and finishes through
  declared transitions only.
- Driving out of order, backward, repeatedly, or through overlapping volumes
  cannot manufacture checkpoint or lap progress.
- The first and later laps share the same start/finish gate and route sequence.
- Race and lap time do not change with render refresh rate, pause duration, or
  presentation updates, and a slow device does not receive free discarded time.
- Recovery is fast and forgiving without becoming a timing or shortcut exploit.
- Progression consumes any validated course document and never hard-codes the
  rough course, Falls View Park, or a database publication.

## Lifecycle Model

The states are:

- `loading`: required course, runtime, kart, and race configuration are not all
  ready;
- `ready`: the race is initialized at the start pose and progression is armed,
  but countdown has not begun;
- `countdown`: the configured pre-start duration is advancing while driving
  remains neutral;
- `racing`: driving, checkpoint progression, lap timing, and finish detection
  are active;
- `paused`: simulation and all lifecycle clocks are frozen while the machine
  retains the exact resumable state;
- `recovering`: the kart is being returned to the latest valid recovery anchor
  with driving locked while race time continues; and
- `finished`: the final progression and timing snapshot is immutable.

Allowed ordinary transitions are:

```text
loading -> ready -> countdown -> racing -> finished
countdown  <-> paused(countdown)
racing     <-> paused(racing)
racing     -> recovering -> racing
recovering <-> paused(recovering)
```

`paused` resumes the exact interrupted `countdown`, `racing`, or `recovering`
state. `recovering` returns to `racing` after the configured stabilization
duration. Loading failure is an external runtime error, not a false transition
to `ready`. Replay/restart creates or resets a race through an explicit command;
it does not mutate a finished result implicitly.

Undefined transitions must not partially mutate lifecycle, progression, or
timing. Production callers receive a stable unchanged snapshot; tests and
diagnostics may receive a bounded rejection reason.

## Timing Model

Maintain countdown time separately from competitive race time.

- Countdown begins on `ready -> countdown` and ends exactly on
  `countdown -> racing`.
- Competitive time begins at that racing transition.
- Competitive time advances in `racing` and `recovering`.
- Competitive time does not advance in `loading`, `ready`, `countdown`,
  `paused`, or `finished`.
- A lap time is the difference between authoritative competitive timestamps at
  consecutive valid start/finish crossings, with race start acting as the
  first lap's initial timestamp.
- Finishing captures total and lap times atomically with the final transition.

Use integer fixed-step counts plus explicitly charged discarded-time units, or
an equivalent exact representation with carried remainder. Do not repeatedly
sum display floats or read ambient wall time inside progression. Runtime timing
input must be monotonic, finite, non-negative, injected in tests, and
independent from render cadence.

If the runtime caps catch-up work and discards active elapsed time, charge that
discarded duration to the competitive timeline before exposing the next
progression result. A stall must never improve a race time. Leaderboard
eligibility may later reject excessively degraded runs; that policy is separate.

Keep countdown length, lap count, and recovery stabilization in race
configuration rather than embedding them in transition logic.

## Ordered Progression

Build the route from the validated start/finish gate followed by checkpoints in
explicit contiguous `order`. Stable IDs identify targets; array indexes and
engine entity names are projections only.

At race start, checkpoint one is the only expected target and the start/finish
gate is disarmed. A checkpoint crossing is valid only when:

1. lifecycle state is `racing`;
2. the kart's previous-to-current fixed-step reference-point segment crosses
   the expected checkpoint's directed gate plane inside its oriented bounded
   volume;
3. movement has positive progress along the checkpoint's authored route
   direction; and
4. no other progression target has already been accepted in the same fixed
   step.

Accepting a checkpoint advances the expected stable ID and makes that
checkpoint the latest recovery anchor. After the final ordered checkpoint, arm
only the start/finish gate. A valid forward gate crossing completes one lap,
records its time, resets the expected target to checkpoint one, and updates the
recovery anchor to the start pose. Completing the configured final lap instead
captures the result and transitions atomically to `finished`.

Swept crossing prevents a fast kart from passing through a thin target between
fixed poses: the previous point must be behind the directed plane, the current
point at or past it, and the intersection inside the oriented bounds. The plane
is a full face of the checkpoint volume, not a free diagonal through it, which
would leave only a narrow valid slice.

## Invalid Progression

The following leave lap, checkpoint, recovery, and timing history unchanged:

- any crossing outside `racing`;
- an out-of-order or skipped checkpoint;
- a repeated checkpoint;
- a reverse-direction crossing;
- crossing the start/finish gate before all ordered checkpoints;
- remaining inside or recovering into a target volume;
- a non-finite or zero-length pose segment; and
- any crossing after `finished`.

Ignoring an invalid crossing is preferable to resetting legitimate progress or
punishing an ordinary driving mistake. Expose bounded diagnostic categories for
tests and later summarized telemetry without retaining per-frame paths or
creating persistent race state.

## Course Contract

Progression needs authored meaning on the course document:

- a bounded start/finish gate on the start pose, whose rotation defines valid
  forward travel; the start pose is also the initial recovery anchor;
- one explicit forward crossing direction per checkpoint, snapped to a full face
  of its oriented detection volume; and
- one explicit safe recovery transform per checkpoint, at ground level and
  facing the departure direction.

Arrival and departure stay separate because a checkpoint on a corner may be
crossed facing into the turn but should recover facing out of it. Never infer
recovery height from the trigger center or reuse the detection rotation without
an explicit sign. Generated defaults must still pass course-specific support
and clearance checks before a course is accepted for play.

Moving a checkpoint translates its recovery pose by the same delta; rotating it
rotates the gate direction; scaling changes only face bounds. None of these
silently rewrites recovery rotation.

The project's versioned schema and its migration path from older documents live
in [`project-systems/course-data`](../../project-systems/course-data/README.md).

## Recovery Model

Before checkpoint one, the start pose is the active recovery anchor. Each valid
checkpoint replaces it; a valid lap crossing returns it to the start pose.

Manual reset and the existing fall boundary request recovery through the race
lifecycle rather than teleporting independently. An accepted request:

1. enters `recovering` once and neutralizes driving input;
2. teleports the physics kart to the active authored recovery transform;
3. clears linear and angular velocity and controller transient state;
4. clears held input and pending destructive edges;
5. synchronizes visual interpolation and chase-camera state immediately;
6. preserves lap, expected checkpoint, completed times, and competitive time;
   and
7. returns to `racing` after the configured stabilization interval.

Recovery time counts competitively. Pausing during recovery freezes and later
resumes the remaining stabilization time. Spawning inside a detection volume
cannot count as crossing because progression requires a valid movement segment
through the expected target after recovery ends.

If the authored recovery pose cannot provide support or clearance at runtime,
fall back toward the nearest previously validated recovery anchor and finally
the start pose. Never place the kart at an unverified trigger center or preserve
pre-recovery momentum.

## Persistence Boundary

Live race state is memory-local and ends with the scene. Do not write
lifecycle transitions, fixed steps, checkpoint progress, timing counters, or
recovery snapshots to Postgres. Telemetry may store summarized
run outcomes and Phase 5 persists final results; neither changes the runtime
authority defined here.

## Failure Modes

- Independent booleans for paused, finished, recovering, and countdown permit
  impossible combinations and partial transitions.
- Counting trigger-enter events without expected-order and direction checks
  rewards shortcuts, reversing, overlap, and duplicated callbacks.
- Using the last checkpoint as the finish line makes the first lap shorter when
  the kart starts elsewhere.
- Sampling only the current pose can tunnel through a thin checkpoint.
- Using render time or component state as timing truth makes results vary with
  refresh rate and React scheduling.
- Dropping capped catch-up duration without charging it rewards stalled or slow
  clients.
- Freezing competitive time during recovery makes reset a shortcut strategy.
- Teleporting to a trigger center can spawn above, below, inside, or facing
  across the route.
- Preserving velocity, held throttle, interpolation history, or camera lag
  after teleport creates repeated crashes and disorienting presentation.
- Persisting live solo state every fixed step adds latency, privacy, and failure
  modes without improving the rough local race loop.

## Validation

1. Transition-table tests prove every allowed transition and that undefined
   transitions leave the snapshot unchanged.
2. Timing tests cover countdown boundaries, lap splits, pause/resume from every
   resumable state, recovery time, finish freezing, fractional carry, and
   discarded-time charging.
3. Geometry and progression tests cover forward, reverse, side, thin-gate, and
   zero-length movement; skips, repeats, early finish crossings, multiple laps,
   and at most one acceptance per step.
4. Recovery integration proves anchor selection, support fallback, upright
   orientation, cleared velocity and input, camera snapping, and no
   teleport-created crossing.
5. Equivalent races at common render cadences and during a capped stall never
   grant shorter competitive time.

## Primary Sources

- [Game Programming Patterns: State](https://gameprogrammingpatterns.com/state.html)
- [Gaffer On Games: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- [Fortnite Race Checkpoint devices](https://dev.epicgames.com/documentation/fortnite/using-race-checkpoint-devices-in-fortnite-creative)
- [Fortnite Race Manager devices](https://dev.epicgames.com/documentation/en-us/fortnite/using-race-manager-devices-in-fortnite-creative)
- [Fortnite checkpoint recovery example](https://dev.epicgames.com/documentation/fortnite/parkour-elimination-3-race-area-in-unreal-editor-for-fortnite)
- [SuperTuxKart TrackSector recovery reference](https://privacy.supertuxkart.net/classTrackSector.html)

## Known Limits

- Generated recovery defaults require per-course runtime evidence; community
  courses (Phase 7) may need recovery-pose authoring controls.
- Ghosts, persistent results, leaderboard eligibility, multiplayer authority,
  anti-cheat, and resuming a race after refresh are later work.
