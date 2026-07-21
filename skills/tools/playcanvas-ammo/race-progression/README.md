# PlayCanvas And Ammo Race Progression

**Maturity:** Validated. The PlayCanvas 2.20.6 and browser-runtime mapping passed
the course-version, fixed-step, directed-gate, recovery, browser,
independent-review, and feature-lead acceptance gates for PR 2.4.2 on 2026-07-13.

## Purpose And Scope

This node maps the engine-independent
[`race-progression`](../../../game-concepts/race-progression/README.md) standard
onto the repository-owned PlayCanvas fixed-step runtime, pinned PlayCanvas
Engine `2.20.6`, and vendored Ammo.js/Bullet physics world.

It inherits fixed-step, public rigid-body reset, interpolation, direct-Ammo
containment, and teardown rules from the parent
[`PlayCanvas and Ammo`](../README.md) node. Read the sibling
[`wheel-suspension`](../wheel-suspension/README.md) node when changing support
queries and [`chase-camera`](../chase-camera/README.md) when changing camera
snap behavior.

## Ownership Boundary

Keep lifecycle, timing, directed-gate geometry, checkpoint/lap progression, and
recovery-anchor selection in ordinary TypeScript. The engine adapter supplies:

- authoritative previous and current physics-root poses;
- fixed-step and discarded-time increments;
- PlayCanvas Euler/quaternion conversion at course-load boundaries;
- filtered support-query results for recovery validation; and
- one imperative recovery operation over the existing kart, controller,
  presentation, input, and camera owners.

Do not put PlayCanvas entities, Ammo objects, DOM events, React state, database
metadata, or formatted timer strings in race snapshots.

## Fixed-Step Ordering

Use the owned outer loop and its existing order:

1. sample normalized input before physics;
2. advance countdown or recovery lifecycle state for one fixed interval;
3. neutralize driving unless the resulting state accepts it;
4. apply an accepted recovery teleport before world advance;
5. update the kart controller with the accepted driving vector;
6. call `app.update(1 / 120)` exactly once;
7. capture the resulting authoritative kart pose;
8. run directed-gate progression after physics; and
9. update presentation/camera telemetry without feeding it back into gameplay.

A pause request sampled before a step becomes effective at the completed
fixed-step boundary. Neutralize new driving for that step, complete one coherent
physics and post-step snapshot, transition the lifecycle to `paused`, then stop
the runtime accumulator. Resume restores the lifecycle state before unpausing
the runtime and retains the existing neutral-input re-arming rule.

Manual stepping while the runtime is deliberately paused remains a test tool.
It must not accidentally resume lifecycle time or accept production input.

## Discarded-Time Mapping

Extend `FixedStepFrame` with the duration discarded by the current browser
frame in addition to the existing cumulative diagnostic total. Deliver that
duration through a dedicated runtime callback after all executable fixed steps
and before render.

The race core consumes discarded duration without moving the kart or evaluating
gates. Apply it to the lifecycle state that exists after the executed steps:

- consume remaining countdown time first and begin competitive time with any
  leftover duration;
- charge `racing` or `recovering` competitive time;
- ignore it in `loading`, `ready`, `paused`, or `finished`; and
- allow discarded duration to complete the recovery stabilization interval
  without manufacturing a checkpoint crossing.

Keep per-frame discarded time finite and non-negative. Manual fixed steps report
zero discarded duration. Resetting the runtime clock on pause clears only the
accumulator and dropped-time transport state, never the race core's accepted
timing snapshot.

## Directed-Gate Mapping

Do not create PlayCanvas collision or rigid-body trigger entities for
checkpoints. Trigger-enter events are overlap lifecycle notifications, not the
ordered, directed, swept crossing authority required by Titan Racers.

At course normalization time, convert each authored checkpoint into plain gate
data:

- center and positive half-extents from its detection transform;
- inverse rotation or equivalent orthonormal axes for bounds testing;
- the rotated local box axis best aligned with the normalized authored
  `forward` hint as the signed full gate-plane normal; and
- stable target ID and order.

Canonicalize that normal before the pure race core sees it. Do not use a free
diagonal normal through a thin oriented box: it reduces the usable crossing
area to a narrow slice even though the kart is visibly inside the checkpoint.

For every post-physics step, pass the previous and current authoritative
physics-root reference positions into the pure crossing helper. Require the
previous signed plane distance to be behind a small epsilon and the current
distance to reach or pass the plane. Solve the segment intersection fraction,
transform that point into the authored detection box, and accept only when it
lies within all half-extents plus one small numeric tolerance.

Initialize both pose samples to the same position at scene start, pause/resume,
and recovery. Teleporting onto a gate therefore cannot create a crossing.
Process only the currently expected stable ID and accept at most one target in
one fixed step.

PlayCanvas `Quat.setFromEulerAngles`, `invert`, and `transformVector` may prepare
plain axes at the adapter boundary. Pure tests should not require PlayCanvas.

## Version-Two Course Mapping

Keep a strict stored version-one schema and a strict canonical version-two
schema. `parseCourseDocument` accepts unknown input, validates its declared
version, and deterministically normalizes supported version one into an owned
version-two value. It also aligns candidate version-two forward hints to the
authored gate face in memory, preserving compatibility with already-published
diagonal values without mutating their stored revisions. New canonical
serialization and saves use version two.

Version-two additions are:

- `start.gateHalfExtents`;
- `checkpoints[].forward`; and
- `checkpoints[].recovery`.

For a version-one checkpoint, use the route tangent between its preceding and
next anchors to choose and sign the best-aligned rotated gate axis. A valid
single-checkpoint document uses start-to-checkpoint arrival direction. Derive
recovery departure yaw from that checkpoint toward the next route anchor, wrapping the
final checkpoint toward the start. Derive ground-level recovery position from
the lower face of the checkpoint volume and use reviewed default start-gate
dimensions. Reject degenerate coincident anchors or a direction that cannot
identify a gate face rather than inventing one.

Database JSON revisions remain immutable. A loaded v1 row is normalized in
memory; the next accepted save creates a new v2 revision. Persistence response
metadata must describe the normalized document consistently without updating
the historical row in place. Publication and editor tests must prove this
compatibility path.

Moving a checkpoint through the current editor translates its recovery position
by the same delta. Detection rotation applies the same transform delta to the
gate-face direction; scaling changes the face bounds without changing its local
axis or sign. Recovery rotation remains independent. New checkpoints derive
bounded direction and recovery defaults from their neighbors. Start movement
carries the start gate; start gate sizing and separate direction/recovery
controls may remain non-visible in PR 2.4.2 so long as the canonical data is
preserved and testable.

## Recovery Mapping

Resolve the active recovery transform to PlayCanvas values only when recovery
is requested:

1. cast a filtered public `RigidBodyComponentSystem.raycastFirst` query from
   above the authored recovery position to below it;
2. accept only an entity tagged `drivable-surface` through the established
   collision filters;
3. compute the chassis physics-root position from the supported ground point,
   kart clearance, center-of-mass offset, and authored recovery rotation;
4. fall back through earlier validated anchors and finally the start if support
   is absent;
5. call the public dynamic-body `teleport(position, rotation)` API;
6. set public `linearVelocity` and `angularVelocity` to zero, activate the body,
   and reset controller transient state;
7. clear normalized input and touch presentation; and
8. snap kart interpolation and chase-camera state to the teleported pose.

PR 2.4.2 does not add a direct Ammo overlap/contact-test boundary. Rough-course
recovery clearance is established by authored placements, filtered support
evidence, collision observation, and browser QA. If future unrestricted course
publishing requires automatic shape-clearance validation, research it as a
separate direct-Ammo capability with allocation, filtering, and performance
evidence.

Falling below the existing boundary requests lifecycle recovery rather than
calling teleport independently. Suppress recursive fall requests while already
recovering.

## Pause And Presentation Mapping

The lifecycle is authoritative for paused state; React owns only the accessible
overlay projection. Keep the separate controller-menu polling path active while
the simulation is paused. Opening, resuming, and exiting continue to use real
DOM focus and the normalized input system's clearing/re-arming guarantees.

The shipped countdown, checkpoint, lap, timer, recovery, and finish HUD projects
the authoritative race snapshot through React. The scene test adapter remains
non-production verification infrastructure and must not become runtime authority.

## Persistence Boundary

Do not add race tables or network writes in PR 2.4.2. Lifecycle, pose history,
checkpoint progress, timing, and recovery anchors live with the scene. Course
documents and publications keep their existing persistence behavior. Later
telemetry receives summarized events; Phase 5 owns durable results, ghosts, and
leaderboard submissions.

## Verification

1. Pure tests cover state transitions, pause-resume targets, timing,
   discarded-time routing, directed-plane crossing, bounds, order, laps, finish,
   and recovery-anchor selection.
2. Course tests cover strict v2 validation, normalized forward vectors,
   recovery transforms, canonical serialization, v1 normalization, degenerate
   rejection, and stable stored revision compatibility.
3. Runtime tests lock pre-step, world-step, post-step, discarded-time, pause,
   and render ordering.
4. Editor tests prove checkpoint/start moves, scaling, deletion, save, load,
   publication, and backup preserve canonical v2 meaning.
5. Browser tests drive or place the kart through valid, skipped, repeated,
   reverse, finish-line, and two-lap scenarios using the non-production semantic
   adapter only for deterministic setup and observation.
6. Recovery tests prove supported start/checkpoint fallback, route orientation,
   zero velocities, input clearing, camera/presentation snap, stabilization
   timing, and no teleport-created checkpoint.
7. Equivalent 30, 60, and 120 Hz frame schedules produce identical progression
   and fixed-step time. A capped frame stall charges discarded active time.
8. Existing physics, collision, camera, input, protected editor, publication,
   desktop/mobile browser, static, and production-build regressions remain
   green.

## Primary Sources

- [PlayCanvas 2.20.6 rigid-body component API](https://api.playcanvas.com/engine/classes/RigidBodyComponent.html)
- [PlayCanvas 2.20.6 rigid-body system and raycast API](https://api.playcanvas.com/engine/classes/RigidBodyComponentSystem.html)
- [PlayCanvas 2.20.6 quaternion API](https://api.playcanvas.com/engine/classes/Quat.html)
- [PlayCanvas physics basics](https://developer.playcanvas.com/user-manual/physics/physics-basics/)
- [PlayCanvas direct Ammo boundary](https://developer.playcanvas.com/user-manual/physics/calling-ammo/)
- [Bullet Physics user manual](https://github.com/bulletphysics/bullet3/blob/master/docs/Bullet_User_Manual.pdf)

## Known Limits

- Support raycasts are zero-width and prove ground support, not full chassis
  clearance.
- PR 2.4.2 deliberately avoids physics trigger entities and new direct-Ammo query
  allocation for race progression.
- Generated v1 recovery defaults are compatibility data, not a substitute for
  course-specific recovery QA.
- Final race presentation, recovery tuning, complete cross-device loop QA,
  persistent results, and multiplayer authority remain later work.
