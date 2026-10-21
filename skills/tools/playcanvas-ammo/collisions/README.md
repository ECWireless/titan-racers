# PlayCanvas and Ammo Vehicle Collisions

**Maturity:** Validated (accepted 2026-07-10).

## Purpose and Scope

This node maps the engine-independent
[`collisions`](../../../game-concepts/collisions/README.md) standard onto the
repository's pinned PlayCanvas Engine and vendored Ammo.js/Bullet build. Read it
before changing kart or course collision shapes, contact material values,
collision observation, CCD, collision debug rendering, or collision-focused
test adapters.

Read the sibling
[`wheel-suspension`](../wheel-suspension/README.md) mapping when changing
finite-radius wheel support, visible suspension travel, or the lateral collision
policy for protruding wheels.

It inherits the runtime, stepping, body, allocation, and teardown rules from
the parent [`PlayCanvas and Ammo`](../README.md) node. The shipped system lives
in [`project-systems/collisions`](../../../project-systems/collisions/README.md).

## Collision Shapes

### Kart envelope

Keep one compound collision root on the authoritative dynamic kart. PlayCanvas
supports box, sphere, capsule, cylinder, cone, mesh, and compound collision
components. Its capsule implementation supports X, Y, and Z axes through the
component's `axis` property and the corresponding Ammo capsule shapes.

Kart collision shapes come from each kart's authored parts marked solid
(boxes and cylinders), derived by `kart-derivation.ts`; see the project-system
node. An envelope must preserve width, length, ground clearance,
center-of-mass relationship, ramp behavior, and off-center lever arms. Visual details do not automatically earn
physical shapes, and one continuous outer surface beats several exposed
children with conflicting normals.

PlayCanvas compound children share the parent rigid body's friction,
restitution, damping, mass, and CCD state. Per-child material behavior is not a
stable public component capability in this baseline.

### Course geometry

Use static PlayCanvas boxes, cylinders, capsules, or deliberate compounds for
course geometry. Keep visual and physical shapes separate when
needed. Use authored thickness and clean alignment for barriers, floors, and
ramps.

Mesh collision is not used. If authored track geometry ever genuinely needs a
triangle mesh, investigate mesh cooking, triangle quality, internal-edge normal
correction, and mobile cost as a separate measured extension.

### Collision margins

The vendored Ammo build exposes `getMargin` and `setMargin`, but PlayCanvas
2.20.6 does not expose collision margin as a stable collision-component
property, so margins use engine defaults. Correct shape size, seams, and
transitions before reaching through private component shapes to change margins.

Any later direct margin use must stay in the reviewed Ammo adapter, document
which root or child shape it affects, survive body/shape recreation, and prove
that it fixes a measured problem without visible hovering, premature contact,
phantom corners, or material performance cost.

## Contact Materials

Use the public PlayCanvas rigid-body `friction`, `restitution`, and, only when
justified, `rollingFriction` properties. These values belong to bodies rather
than visual materials.

For this Ammo/Bullet baseline, the default material combiner multiplies the two
bodies' friction values and multiplies their restitution values. PlayCanvas's
2.20.6 API documentation explicitly records the restitution multiplication.
The default kart construction friction of `0.12` against static-course
friction of `0.7` therefore produces approximately `0.084` combined
chassis-contact friction. Its construction restitution of `0.04` against
course restitution of `0` produces zero combined restitution. These kart-body
values are construction inputs rather than live handling overrides.

Tune both bodies deliberately. Keep chassis-contact friction low enough for readable
glancing slides, and keep tire force and surface grip in the wheel controller;
do not use rigid-body friction to replace the tire model. Use restitution
sparingly and verify low-speed rest stability and multi-contact behavior.

Custom Bullet material-combiner callbacks are not used. The
vendored binding and PlayCanvas lifecycle do not provide a stable project-owned
boundary for them, and the required behavior should first be attempted with
body-level values and geometry.

## Collision Observation

Subscribe to the global `contact` event on
`app.systems.rigidbody`. In PlayCanvas 2.20.6 it supplies a
`SingleContactResult` for each manifold point with:

- entities `a` and `b`;
- local and world contact points for each entity;
- the Bullet world normal on body B; and
- the accumulated solver impulse from the last internal substep.

With the vendored build's internal tick callback, PlayCanvas checks manifolds
and emits collision/contact events after each internal substep, inside
`stepSimulation` and before dynamic entity transforms sync. These events are
therefore post-solve. The engine reuses its contact and result objects from
object pools and frees the pool at the end of the collision scan. Copy every
vector, number, and entity classification needed by gameplay, telemetry, or
tests inside the event handler. Never retain the result object or its vectors.

Use the global event rather than a kart-local reverse `ContactResult` because
the global result preserves body A/B identity. Orient the gameplay normal away
from the contacted body and toward the kart:

- if the kart is body A, use the supplied normal; and
- if the kart is body B, negate it.

Capture kart linear velocity, angular velocity, pose, and grounded state in the
existing pre-physics callback. Compute pre-solve contact-point velocity from
linear velocity plus angular velocity crossed with the center-to-contact
offset. Pair the copied event with post-step kart state after `app.update`
returns.

Aggregate all kart contact points from one fixed step into one collision-frame
observation. Preserve the complete copied point list for diagnosis, while
exposing stable summaries such as:

- contacted entity names and classifications;
- maximum normal approach speed;
- total and maximum normal impulse;
- impulse-weighted or strongest contact point and normal;
- pre/post linear and angular velocity;
- grounded, partial-support, and airborne state; and
- CCD and assist configuration.

Do not treat every manifold point as a separate gameplay impact. Do not rely on
`collisionstart` alone because a sustained or changing contact can produce
important later impulses without starting a new body pair.

## Continuous Collision Detection

PlayCanvas does not expose CCD properties on `RigidBodyComponent`. The vendored
Ammo body does expose:

- `setCcdMotionThreshold(distance)`, which enables a CCD motion test when a
  body's movement during a step exceeds the configured distance; and
- `setCcdSweptSphereRadius(radius)`, which configures the swept sphere used by
  Bullet's CCD path.

Keep both calls inside the reviewed direct-Ammo adapter. The vendored binding
does not expose matching getters, so the adapter must validate and retain the
configured values as ordinary TypeScript data for telemetry and tests.

Apply CCD only after the PlayCanvas rigid body exists. Reapply it whenever
PlayCanvas recreates the body. Setting the threshold to zero is
the explicit disabled state.

Derive settings from measurement: top speed and per-step travel, the
envelope's smallest relevant cross-section, the thinnest required static
fixture, and tunneling behavior with CCD disabled. Choose a threshold that
avoids low-speed sweeps and a swept-sphere radius smaller than the
cross-section, then test missed hits and premature contacts.

A `17 m/s` kart travels about `0.142 m` in one 120 Hz step. Each kart's
smallest relevant cross-section is derived from its solid parts; shared policy
sets the swept-sphere radius to half of it and the activation threshold to 75%
of that radius. Test through at least `20.4 m/s` (20% above top speed).
Neither ratio is player-authored tuning.

Bullet's swept-sphere path primarily protects translational motion. Do not
assume it covers every fast rotational corner. Keep honest collider thickness
and include high-angular-velocity scenarios. Verify that CCD does not create
sticking, time loss, unstable bounce, false hits, or unacceptable mobile cost.

## Internal Substeps

The sphere sweeps from the body center, so it cannot stop an off-center
leading face from overlapping a thin wall. Bound per-substep travel instead:
PlayCanvas passes `rigidbody.fixedTimeStep` and `maxSubSteps` to
`stepSimulation(dt, maxSubSteps, fixedTimeStep)` on every update, so both may
change per fixed step. Within one `stepSimulation`, applied forces persist
across internal substeps (Bullet clears them once at the end), and the
vendored build's internal tick callback makes PlayCanvas emit contact events
after every substep. Never call `stepSimulation` repeatedly instead; forces
clear after the first call.

Use power-of-two counts. Ammo is float32, and `dt / 2^k` is exact there, so
`m_localTime` returns to zero and the motion state is not interpolated.
Counts such as 3 leave a remainder that Bullet carries and interpolates.

## Collision Assists

No collision assist is active. Before adding one, correct and tune collision geometry, material
response, mass properties, tire-force interaction, and targeted CCD first.

If a repeatable accepted scenario still fails, observe the post-solve contact
and schedule any bounded response for the next fixed step. Prefer the public
`RigidBodyComponent.applyImpulse(impulse, relativePoint)` API. Keep the impulse
small, apply it at a meaningful point when rotation is intended, and never
assign a complete replacement linear velocity, angular velocity, pose, or
orientation.

An assist implementation must expose its match criteria, priority, limit,
cooldown or one-shot policy, and activation telemetry. Test it enabled and
disabled. Do not implement a generic rule engine before more than one accepted
collision response actually needs it.

## Debug Rendering and Test Access

The vendored Ammo build includes debug-drawer bindings, but a full Bullet debug
drawer adds a direct-Ammo lifecycle and rendering boundary, so it is not used.

Prefer project-owned diagnostics built from copied ordinary data:

- simple collision-envelope visualization;
- contact-point markers and normal lines;
- numeric pre/post velocity and impulse telemetry;
- CCD threshold, swept sphere, and activation state; and
- a deliberate development/test adapter for controlled scenario setup and
  results.

Keep all test hooks disabled from production behavior through the repository's
existing test-adapter boundary. Debug rendering must not mutate the physics
world or feed presentation state back into collision response.

## Verification

After collision, envelope, CCD, or engine changes, confirm: normals orient
correctly with the kart as body A and body B; pooled contact data is copied and
stable after the callback; multi-point manifolds produce one per-step
observation; resets and teleports leave CCD and filters configured without
stale contacts; the thin barrier holds at the safety speed; render cadence does not
change outcomes; production builds make no third-party requests; and teardown
removes every listener and allocation.

## Known Limitations

- PlayCanvas contact events are post-solve. Exact pre-solve values must be
  reconstructed from the controlled pre-step state rather than read from an
  engine callback.
- Contact objects and vectors are pooled and must be copied synchronously.
- The public component API has no CCD or collision-margin properties.
- The vendored Ammo binding has CCD setters but not CCD getters.
- Body-level material values apply to the complete compound kart.
- Per-part compound-child contact materials are unavailable through the public
  engine boundary, so the kart uses one whole-body construction material.

## Sources

- [PlayCanvas 2.20.6 `RigidBodyComponent` API: materials, impulses, and contact
  events](https://api.playcanvas.com/engine/classes/RigidBodyComponent.html)
- [PlayCanvas 2.20.6 `ContactPoint` API: points, normal, and solver
  impulse](https://api.playcanvas.com/engine/classes/ContactPoint.html)
- [PlayCanvas physics basics: supported collision shapes and simplified
  physical geometry](https://developer.playcanvas.com/user-manual/physics/physics-basics/)
- [PlayCanvas forces and impulses](https://developer.playcanvas.com/user-manual/physics/forces-and-impulses/)
- [PlayCanvas direct Ammo access and CCD](https://developer.playcanvas.com/user-manual/physics/calling-ammo/)
- [Bullet `btCollisionObject`: material, contact-processing, and CCD
  controls](https://pybullet.org/Bullet/BulletFull/classbtCollisionObject.html)
- [Bullet `btManifoldResult`: contact material combination and customization
  boundary](https://pybullet.org/Bullet/BulletFull/classbtManifoldResult.html)
- [Bullet internal-edge utility](https://pybullet.org/Bullet/BulletFull/btInternalEdgeUtility_8h.html)
- [Erin Catto, Continuous Collision: discrete misses, speculative contacts,
  and time-of-impact tradeoffs](https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf)
