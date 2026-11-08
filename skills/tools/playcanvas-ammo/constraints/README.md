# Ammo Constraints

**Maturity:** Candidate (PR 6.9, 2026-11-08; measured in Node against the
vendored build).

## Purpose And Scope

How hinges and breakable latches behave on the vendored Ammo build under
Titan Racers' fixed-step runtime with variable substeps. Read it before
adding a joint between bodies, or between a body and the world. It maps the
[course interactables](../../../game-concepts/course-interactables/README.md)
standard, and inherits stepping and substeps from
[collisions](../collisions/README.md#internal-substeps).

## Build Constraints In Ammo, Not With JointComponent

PlayCanvas 2.20.6 has a `JointComponent` (fixed, ball, hinge, slider, and
6-DOF) with a break impulse and a `break` event. It doesn't fit this
runtime:

- The vendored build exposes neither `isEnabled` nor `getAppliedImpulse`
  on constraints, so the component notices a break only when its anchors
  drift more than 0.2 m apart.
- Its hinge motor turns `maxMotorForce` into an impulse with the
  rigid-body system's `fixedTimeStep` when the motor is set. The runtime
  changes the substep length every fixed step, so that impulse goes stale.

Build constraints in Ammo, on bodies from `rigidbody.body`, into
`app.systems.rigidbody.dynamicsWorld`. The one-body constructors
(`btHingeConstraint(body, frame, false)`, `btPoint2PointConstraint(body,
pivot)`) join a body to the world. Pass `true` to `addConstraint` so the
joined bodies don't collide. On teardown, remove each constraint and
`Ammo.destroy` it before its bodies.

## Breaking Thresholds

- `setBreakingImpulseThreshold(J)` clamps each constraint row's impulse
  within a solve to ±J. After the solve, it disables the constraint if any
  row reached J. The check is per row and per internal substep. A
  point-to-point latch has three rows, so the row along the hit carries
  it.
- An inelastic hit lands almost wholly in its first substep, so the
  breaking speed barely depends on the substep count. A 1.85 kg box hit a
  40 kg door square, 0.75 m from the hinge, with the latch 0.95 m out. At
  J = 8 N·s it broke the latch at 5.9–6.3 m/s for 1, 2, 4, and 8 substeps,
  and at 12.6 N·s at 8.8–9.4 m/s.
- Calibrate in a test, not from the kart's momentum. The hinge carries part
  of the hit, and the lever arms set how much reaches the latch. At
  J = 8 N·s the breaking speed was 9.1 m/s at 0.5 m from the hinge,
  15.7 m/s at 0.3 m, and above 25 m/s at 0.15 m.
- The latch takes up to J before it gives, so the body behind it gets only
  what is left. A hit just over the threshold cracks a door open a few
  degrees.
- There is no `isEnabled`. Detect the break from its effect, such as the
  hinge angle leaving its closed stop, then remove the latch. A disabled
  constraint can't be re-enabled through this build, so a reset adds a new
  one.

## Hinges

- `setLimit(low, high, 0.9, 0.3, 1.0)` sets both stops, in radians, with
  Bullet's default softness, bias, and relaxation. `getHingeAngle()` reads
  the angle; its sign follows the frame's axis.
- Friction is a motor with zero target speed:
  `enableAngularMotor(true, 0, torque × substepLength)`. The motor's limit
  is an impulse per solve, so set it again whenever the substep count
  changes.
- A 40 kg door with 2 N·m of friction, hit square 0.75 m from its hinge and
  breaking a J = 9.2 N·s latch, opened 6° at 7.5 m/s and 71° at 12 m/s.
  At 17 m/s it reached its 90° stop in 1.4 s.
- A hinged body that overlaps its frame or wall collides with it unless
  filtered. Give it a group and a mask that admit only what should hit it.

## Related

- [Course interactables standard](../../../game-concepts/course-interactables/README.md)
- [Collisions in PlayCanvas and Ammo](../collisions/README.md)
