# Race Lifecycle And Progression

**Maturity:** Candidate. The feature lead accepted this engine-independent
standard for PR 4B on 2026-07-13. Promote it to validated only after the
versioned course contract, lifecycle, timing, progression, recovery, runtime
verification, independent review, and feature-lead QA pass.

## Purpose And Scope

This node defines the Titan Racers standard for race lifecycle, ordered
checkpoint and lap progression, deterministic timing, invalid-progression
handling, and checkpoint recovery. Read it before changing race states,
countdowns, pause semantics, checkpoint crossing, lap completion, finish
results, reset policy, or race-time accounting.

It does not own device bindings, kart forces, final HUD presentation, database
results, telemetry persistence, ghosts, leaderboards, multiplayer authority, or
a particular engine query API. Player input supplies normalized action state
and reset/pause edges. Tool-specific mapping belongs under
[`../../tools/`](../../tools/README.md). Verified repository ownership belongs
under [`../../project-systems/`](../../project-systems/README.md) only after
implementation and acceptance.

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
  rough course, Agricultural Zone, or a database publication.

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
progression result. A stall must never improve a race time. Later leaderboard
eligibility may reject excessively degraded runs, but eligibility policy is not
part of PR 4B.

The rough-loop configuration uses a three-second countdown, two laps, and a
half-second recovery stabilization window. Keep these values in race
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

Swept plane-crossing evaluation prevents a fast kart from passing entirely
through a thin target between fixed poses. The previous point must be behind
the directed plane, the current point must reach or pass its front, and the
intersection point must lie inside the oriented checkpoint bounds. Entering
the box from a side, spawning on the plane, or moving backward does not advance
progress. Accept no more than one target per fixed step so overlapping or badly
spaced authored volumes cannot cascade through the route.

The gate plane is a full authored face of the checkpoint volume. The normalized
`forward` value identifies the best-aligned rotated local axis and chooses which
side of that face is forward; course normalization snaps it to that exact
world-space axis. A free diagonal plane through a thin box would leave only a
narrow valid slice and make legitimate off-center crossings unreliable.

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

Race progression requires authored meaning that version-one course documents
do not contain. Version two adds:

- bounded start-gate half-extents to the existing start pose;
- one explicit normalized forward crossing direction on every checkpoint; and
- one explicit safe recovery transform on every checkpoint.

The start pose remains both the initial and pre-checkpoint recovery anchor. Its
rotation defines valid forward travel through the start/finish gate. Construct
the gate volume from the same horizontal pose, raised by its vertical
half-extent so authored start height remains a ground-level kart pose.

A checkpoint's existing transform and half-extents define its oriented
detection volume and full gate face. Its normalized `forward` vector chooses
the valid arrival side of that face and is canonicalized to the rotated
world-space normal. Its recovery transform independently defines a safe
ground-level kart pose and route-aligned upright departure rotation. Arrival
and departure direction remain separate because a checkpoint placed at a
corner may be crossed facing into the turn but should recover facing out of it.
Do not infer recovery height from the trigger center or use the detection box
rotation without an explicit direction sign.

Keep version-one revisions immutable. A deterministic v1-to-v2 normalization
path uses the tangent between neighboring route anchors to choose the
best-aligned checkpoint gate face and sign, derives a recovery departure
rotation toward the next route anchor, and supplies reviewed gate dimensions and ground-level
recovery positions for the existing rough-course seed and stored revisions.
Canonical new saves use version two. Candidate version-two documents are also
aligned in memory so already-published diagonal directions remain playable
without rewriting their stored revisions. Any generated recovery default must
still pass course-specific support and clearance verification before the course
is accepted for play.

Moving a checkpoint translates its recovery pose by the same delta by default.
Rotating its detection volume rotates the authored gate-face direction by the
same transform delta. Scaling changes the face bounds without changing its
local axis or sign, even when another dimension becomes smaller. Neither
operation silently rewrites recovery rotation. New checkpoints receive bounded
direction and recovery defaults; separate direction/recovery authoring and
tuning may become later controls without changing progression semantics.

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

PR 4B race state is memory-local and ends with the scene. Do not write
lifecycle transitions, fixed steps, checkpoint progress, timing counters, or
recovery snapshots to Postgres. Later telemetry may store summarized events,
and Phase 5 may persist final race results and leaderboard eligibility; neither
changes the runtime authority defined here.

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

1. Transition-table tests cover every allowed transition and prove undefined
   transitions leave the complete snapshot unchanged.
2. Timing tests cover countdown boundaries, active race time, lap splits,
   pause/resume from every resumable state, recovery penalties, final-time
   freezing, fractional carry, and discarded-time charging.
3. Geometry tests cover forward swept plane crossings, thin-volume tunneling,
   recovery on the plane, reverse and side entry, zero movement, overlaps, and
   at-most-one acceptance per fixed step.
4. Progression tests cover correct order, skips, repeats, early finish-line
   crossings, multiple laps, final finish, and immutable completed results.
5. Course tests cover strict version-two validation, canonical serialization,
   stable IDs, gate dimensions, recovery transforms, and deterministic
   version-one normalization.
6. Recovery integration proves start and checkpoint anchors, support and
   clearance fallback, route-aligned upright orientation, zero linear/angular
   velocity, input clearing, presentation/camera snapping, and no trigger
   activation from teleport.
7. Runtime tests repeat equivalent races at common render cadences and during a
   capped frame stall without granting shorter competitive time.
8. Existing physics, collisions, camera, course editor, publication, guest
   access, and keyboard/touch/controller input regressions remain green.

## Primary Sources

- [Game Programming Patterns: State](https://gameprogrammingpatterns.com/state.html)
- [Gaffer On Games: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- [Fortnite Race Checkpoint devices](https://dev.epicgames.com/documentation/fortnite/using-race-checkpoint-devices-in-fortnite-creative)
- [Fortnite Race Manager devices](https://dev.epicgames.com/documentation/en-us/fortnite/using-race-manager-devices-in-fortnite-creative)
- [Fortnite checkpoint recovery example](https://dev.epicgames.com/documentation/fortnite/parkour-elimination-3-race-area-in-unreal-editor-for-fortnite)
- [SuperTuxKart TrackSector recovery reference](https://privacy.supertuxkart.net/classTrackSector.html)

## Known Limits

- PR 4B establishes lifecycle behavior and rough-course integration, not the
  final HUD or full cross-device loop acceptance owned by PR 4C.
- The initial countdown, lap count, and stabilization durations remain tuning
  candidates until rough-loop QA.
- Version-two generated recovery defaults require per-course runtime evidence;
  general recovery-pose authoring may need additional Phase 6 controls before
  unrestricted community publishing.
- Ghost recording, persistent results, leaderboard eligibility, multiplayer
  authority, anti-cheat, and race resumption after refresh remain later work.
