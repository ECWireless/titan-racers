# PlayCanvas And Ammo Race Progression

**Maturity:** Validated (PR 2.4.2, 2026-07-13).

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

## Course Data

Directed gates and recovery transforms come from the canonical version-two
course document. Its schema and the in-memory normalization of older stored
revisions are owned by
[`project-systems/course-data`](../../../project-systems/course-data/README.md).

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

There is no direct-Ammo overlap or contact-test boundary. Recovery clearance
comes from authored placements, filtered support evidence, and QA. If community
course publishing (Phase 7) needs automatic shape-clearance validation,
research it as a separate direct-Ammo capability.

Falling below the existing boundary requests lifecycle recovery rather than
calling teleport independently. Suppress recursive fall requests while already
recovering.

## Pause And Presentation Mapping

The lifecycle is authoritative for paused state; React owns only the accessible
overlay projection. Keep the separate controller-menu polling path active while
the simulation is paused. Opening, resuming, and exiting continue to use real
DOM focus and the normalized input system's clearing/re-arming guarantees.

The shipped countdown, lap, timer, recovery, and finish HUD projects
the authoritative race snapshot through React. The scene test adapter remains
non-production verification infrastructure and must not become runtime authority.

## Verification

`tests/race-gate.spec.ts`, `tests/race-session.spec.ts`,
`tests/course-document.spec.ts`, `tests/fixed-step-clock.spec.ts`, and
`tests/playcanvas-runtime.spec.ts` cover crossings, lifecycle, timing,
discarded-time routing, course normalization, and step ordering without
PlayCanvas. Browser coverage drives a two-lap route, reset, and recovery through
the non-production adapter.

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
- Checkpoints use no physics trigger entities and no new direct-Ammo queries.
- Generated recovery defaults for older documents are compatibility data, not a
  substitute for course-specific recovery QA.
