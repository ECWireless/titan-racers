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
`app.systems.rigidbody.dynamicsWorld`. Pass `true` to `addConstraint` so
the joined bodies don't collide. On teardown, remove each constraint and
`Ammo.destroy` it before its bodies.

- `btPoint2PointConstraint(body, pivot)` joins a body to the world at the
  pivot's present world position.
- The one-body hinge, `btHingeConstraint(body, frame, false)`, moves its
  world frame's origin to the world but keeps its basis local. A body that
  isn't turned 0° about the axis then reads its own turn as hinge angle
  (a door turned 90° reads 90° open). Use the two-body form against a fixed
  static body that isn't in the world (mass 0, a 1 mm sphere, identity
  pose, as PlayCanvas's `getFixedBody`), with the world frame the body's
  pose times its local frame.
- Give a new body its entity's pose (`rigidbody.teleport`) before fixing a
  constraint to it.

## Breaking Thresholds

- `setBreakingImpulseThreshold(J)` clamps each constraint row's impulse
  within a solve to ±J. After the solve, it disables the constraint if any
  row reached J. The check is per row and per internal substep. A
  point-to-point latch has three rows, so the row along the hit carries
  it.
- An inelastic hit lands almost wholly in its first substep, so the
  breaking speed barely depends on the substep count.
- Calibrate in a test, not from the kart's momentum. The hinge carries part
  of the hit, and the lever arms set how much reaches the latch: the
  nearer the hinge, the faster a hit must be.
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
- Bullet's hinge angle wraps at ±π, so keep stops clear of 180°.
- A hinged body that overlaps its frame or wall collides with it unless
  filtered. Give it a group and a mask that admit only what should hit it.

## Related

- [Course interactables standard](../../../game-concepts/course-interactables/README.md)
- [Collisions in PlayCanvas and Ammo](../collisions/README.md)
