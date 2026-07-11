# PlayCanvas and Ammo Vehicle Collisions

**Maturity:** Validated. The feature lead accepted this tool mapping on
2026-07-10, and the selected compound envelope, copied contact observation,
targeted CCD configuration, filtering, lifecycle, browser, build, and hands-on
gates now pass in Titan Racers.

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
the parent [`PlayCanvas and Ammo`](../README.md) node. The final Titan Racers
source ownership and accepted data flow belong under
[`../../../project-systems/`](../../../project-systems/README.md) only after the
implementation has been accepted.

## Supported Baseline

- PlayCanvas Engine is pinned exactly to `2.20.6`.
- Physics uses the repository-owned Ammo glue, WebAssembly, and fallback files.
- The runtime owns a 60 Hz outer fixed step with one PlayCanvas/Ammo step per
  outer step.
- The kart is one dynamic compound rigid body with all six degrees of freedom.
- Course surfaces and obstacles are static rigid bodies.
- One PlayCanvas world unit is one metre.

Do not add a collision or physics dependency for this work. A PlayCanvas or
Ammo upgrade is a separate tool change that requires repeating the parent
node's runtime verification and this node's collision verification.

## Collision Shapes

### Kart envelope

Keep one compound collision root on the authoritative dynamic kart. PlayCanvas
supports box, sphere, capsule, cylinder, cone, mesh, and compound collision
components. Its capsule implementation supports X, Y, and Z axes through the
component's `axis` property and the corresponding Ammo capsule shapes.

Compare collision envelopes in controlled scenarios before selecting one:

1. the existing compound boxes as the measured baseline;
2. a simplified longitudinal capsule plus only the upper shape needed to
   preserve rollover behavior; and
3. a central box with overlapping horizontal capsule bumpers that smooth the
   exposed front and rear corners.

The accepted envelope must preserve chassis width, length, ground clearance,
center-of-mass relationship, ramp behavior, and useful off-center impact lever
arms. Visual cockpit or wheel details do not automatically earn physical
shapes. Avoid multiple exposed compound children that create conflicting
contact normals where one continuous outer surface is intended.

PlayCanvas compound children share the parent rigid body's friction,
restitution, damping, mass, and CCD state. Per-child material behavior is not a
stable public component capability in this baseline.

### Course geometry

Use static PlayCanvas boxes, cylinders, capsules, or deliberate compounds for
the rough collision course. Keep visual and physical shapes separate when
needed. Use authored thickness and clean alignment for barriers, floors, and
ramps.

Build focused fixtures for:

- a long straight barrier;
- a convex outside corner;
- a concave inside corner;
- box and round obstacles;
- a ramp with aligned base and crest transitions; and
- the thinnest barrier required by the supported speed envelope.

Do not introduce mesh collision for the PR 2B test course. If later authored
track geometry genuinely requires a triangle mesh, investigate mesh cooking,
triangle quality, internal-edge contact-normal adjustment, and mobile cost as a
separate measured extension.

### Collision margins

The vendored Ammo build exposes `getMargin` and `setMargin`, but PlayCanvas
2.20.6 does not expose collision margin as a stable collision-component
property. Keep engine defaults initially. Correct shape size, seams, and
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
The current kart friction of `0.12` against static-course friction of `0.7`
therefore produces approximately `0.084` combined chassis-contact friction.
The current kart restitution of `0.04` against course restitution of `0`
produces zero combined restitution.

Treat those results as a baseline, not as accepted collision tuning. Tune both
bodies deliberately. Keep chassis-contact friction low enough for readable
glancing slides, and keep tire force and surface grip in the wheel controller;
do not use rigid-body friction to replace the tire model. Use restitution
sparingly and verify low-speed rest stability and multi-contact behavior.

Custom Bullet material-combiner callbacks are outside the initial scope. The
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
- the accumulated solver impulse from the last substep.

PlayCanvas calls Ammo's `stepSimulation`, updates dynamic entity transforms,
then checks manifolds and emits collision/contact events. These events are
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
PlayCanvas recreates the body, including when editor manipulation returns the
kart from kinematic to dynamic participation. Setting the threshold to zero is
the explicit disabled state.

Derive final settings from measurements:

1. record the maximum supported linear speed and per-step travel;
2. record the chosen kart envelope's smallest relevant cross-section;
3. record the thinnest required static collision fixture;
4. demonstrate tunneling or its absence with CCD disabled;
5. choose a motion threshold that avoids unnecessary low-speed sweeps; and
6. choose a swept-sphere radius smaller than the relevant body cross-section,
   then test missed hits and premature contacts.

The current `17 m/s` target travels about `0.283 m` in one 60 Hz step. This is a
measurement anchor, not a hard-coded CCD policy. Test through at least
`20.4 m/s`, which adds the accepted 20% safety margin above default top speed.

Bullet's swept-sphere path primarily protects translational motion. Do not
assume it covers every fast rotational corner. Keep honest collider thickness
and include high-angular-velocity scenarios. Verify that CCD does not create
sticking, time loss, unstable bounce, false hits, or unacceptable mobile cost.

## Collision Assists

Start with no collision assist. Correct and tune collision geometry, material
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
drawer adds a direct-Ammo lifecycle and rendering boundary. Do not adopt it for
the initial implementation.

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

The mapping is not validated until focused tests demonstrate:

1. Each candidate kart envelope is measured against the same glancing, corner,
   ramp, obstacle, and ground-clearance scenarios before one is accepted.
2. Collision materials produce repeatable effective slide and rebound behavior
   without replacing wheel grip.
3. The global contact observer correctly orients normals for the kart as both
   body A and body B.
4. Pooled PlayCanvas result data is copied and remains stable after the contact
   callback returns.
5. Multi-point manifolds produce one stable per-step collision observation
   without duplicate gameplay responses.
6. Pre-solve point approach speed and post-solve linear/angular changes agree
   qualitatively with contact point, normal, and impulse.
7. Editor transitions and resets leave collision observation and CCD in the
   configured state without stale contacts.
8. The thin-barrier test tunnels under a deliberately unsafe discrete setup and
   remains blocked by the accepted CCD configuration, or evidence shows that
   the supported envelope does not need CCD.
9. CCD-disabled and CCD-enabled matrices expose no accepted false contacts,
   sticking, unstable rebound, or excessive cost.
10. Controlled scenarios remain equivalent under synthetic 30, 60, and 120 Hz
    render schedules while physics remains fixed at 60 Hz.
11. Production builds make no third-party physics or asset requests.
12. Teardown removes every contact listener and leaves no animation frame,
    PlayCanvas application, Ammo allocation, or retained entity reference.

Behavior-level acceptance remains owned by the engine-independent collision
node. Add exact scenario poses, speeds, incidence angles, tolerances, and mobile
performance budgets only after runtime measurements establish defensible
values.

## Known Limitations and Open Questions

- PlayCanvas contact events are post-solve. Exact pre-solve values must be
  reconstructed from the controlled pre-step state rather than read from an
  engine callback.
- Contact objects and vectors are pooled and must be copied synchronously.
- The public component API has no CCD or collision-margin properties.
- The vendored Ammo binding has CCD setters but not CCD getters.
- Body-level material values apply to the complete compound kart.
- The accepted kart envelope and final friction, restitution, CCD threshold,
  swept-sphere radius, scenario tolerances, and performance budget still require
  implementation measurements.
- No collision assist is justified until unassisted hands-on and automated
  evidence demonstrates a specific remaining failure.

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
