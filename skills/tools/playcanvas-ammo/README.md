# PlayCanvas and Ammo

**Maturity:** Candidate. The feature lead accepted this tool mapping on
2026-07-10. Promote it to validated only after the runtime, physics integration,
and kart implementation pass their agreed browser and gameplay verification.

## Purpose and Scope

This node maps Titan Racers' engine-independent
[`kart-physics`](../../game-concepts/kart-physics/README.md) standard onto the
PlayCanvas Engine and its Ammo.js/Bullet integration. Read it before changing
physics loading, application stepping, rigid bodies, collision shapes, support
queries, force application, mass properties, CCD, or physics reset behavior.

It owns reusable tool behavior and constraints. The final Titan Racers source
ownership and data flow belong under
[`../../project-systems/`](../../project-systems/README.md) after the
implementation has been accepted.

## Focused Children

- [`collisions/`](collisions/README.md): accepted PlayCanvas 2.20.6 and
  vendored-Ammo mapping for collision geometry, contact telemetry, material
  response, continuous collision detection, and collision verification.
- [`wheel-suspension/`](wheel-suspension/README.md): accepted finite-radius
  wheel-sweep and visible-suspension mapping for the pinned browser physics
  stack.

## Supported Baseline

- PlayCanvas Engine: `2.20.6`, to be pinned exactly while the custom runtime
  integration depends on this lifecycle.
- Physics: the Ammo.js/Bullet build explicitly vendored by the repository.
- Units: one PlayCanvas world unit represents one metre; use kilograms,
  seconds, newtons, and radians where the surrounding API permits.
- Browser delivery: self-host the Ammo glue, WebAssembly, and fallback files.
  Do not require a third-party CDN at runtime.

Record the Ammo upstream revision, license, local paths, and hashes beside the
vendored files. Upgrading either PlayCanvas or Ammo is a deliberate tool change
that must repeat the focused runtime and physics verification below.

## Loading Ammo

Configure the `Ammo` module through `pc.WasmModule.setConfig` and await
`pc.WasmModule.getInstance` before starting the PlayCanvas application. Treat a
load failure as an explicit initialization error; do not silently fall back to
the legacy transform controller.

The runtime owns this asynchronous boot boundary so scene construction never
creates collision or rigid-body components before Ammo is ready.

## Fixed-Step Runtime Ownership

PlayCanvas passes variable render-frame time into its application update. Its
rigid-body system can internally subdivide that time, but ordinary gameplay
callbacks do not run once per internal Bullet substep. That is insufficient for
a kart whose support queries and forces must be recomputed every physics step.

Titan Racers therefore owns the outer simulation accumulator:

1. Accumulate clamped browser-frame time.
2. Before each whole simulation step, sample the current input and run every
   registered pre-physics callback.
3. Call `app.update(1 / 60)`, which advances the PlayCanvas systems and one
   Ammo/Bullet step.
4. Run registered post-physics callbacks and capture the resulting state.
5. Stop after the configured catch-up limit, initially four steps, and record
   any discarded whole-step time.
6. Render once per browser frame and pass the accumulator fraction to
   presentation interpolation.

Configure the PlayCanvas rigid-body system with the same `1 / 60` fixed
timestep and one internal substep. The outer loop, rather than nested Bullet
substepping, is authoritative for normal operation.

Keep stepping, rendering, and lifecycle control in a narrow runtime adapter.
Gameplay controllers receive fixed-step callbacks and must not call
`requestAnimationFrame`, `app.update`, `app.render`, or Bullet stepping APIs.

### Runtime invariants

- Never advance gameplay with a partial or variable simulation step.
- Clamp a single browser-frame contribution before it enters the accumulator.
- Bound catch-up work to avoid a spiral after stalls or backgrounding.
- Expose executed steps, accumulator fraction, and dropped time for tests and
  telemetry.
- Stop the owned animation frame and destroy the application exactly once.
- Keep engine initialization and teardown safe when a React effect is cancelled
  during asynchronous Ammo loading.

## Rigid-Body and Collision Mapping

### Kart chassis

Use a dynamic rigid body with all linear and angular factors enabled. Add a
compound collision shape to the physics root and position simple primitive
child shapes around it. In PlayCanvas the compound parent is the physical
center of mass, so place that root deliberately within the chassis volume and
offset visual children relative to it.

Do not use physical wheel bodies or `btRaycastVehicle` for the current kart.
Visual wheels are children driven by the custom support and steering solution.

Keep chassis contact friction and damping low enough that they do not replace
the custom tire model. Chassis contacts still handle scraping, impacts, and
obstacles.

### Course geometry

Give drivable surfaces and obstacles static rigid bodies with simple primitive
or compound collision shapes. Visual meshes and physics shapes need not match,
but the collision approximation must preserve the gameplay silhouette.

Tag or otherwise classify drivable surfaces separately from walls and
obstacles. Store surface grip as project data associated with the hit entity;
Ammo's contact friction is not the tire model's source of truth.

Avoid dynamic concave mesh colliders. Prefer primitives, compounds, or static
mesh collision only where authored course geometry truly requires it.

## Wheel Support Queries

Use `app.systems.rigidbody.raycastFirst` for the initial support model. Run one
filtered query per wheel from maximum compression toward maximum droop along
the chassis-local suspension direction.

The public result supplies:

- hit entity,
- world-space contact point,
- world-space surface normal, and
- hit fraction along the query.

Reject the kart itself and all entities that are not valid supporting surfaces.
Use collision groups and masks for broad exclusion and an entity classification
for the semantic drivable-surface check.

For each valid hit, compute suspension compression from query geometry. Compute
the wheel-point velocity in TypeScript from rigid-body linear velocity plus the
cross product of angular velocity and the world-space center-to-wheel offset.
Project chassis directions and point velocity into the contact plane before
calculating longitudinal and lateral response.

Ray queries are the candidate baseline. A sweep or shape query may replace them
only if measured ramp, edge, or high-speed behavior demonstrates a material
benefit that justifies the additional Ammo boundary.

## Applying Forces

Use the public `RigidBodyComponent.applyForce(force, relativePoint)` API for
suspension and tire forces. Its application point is a world-space offset from
the body origin, not an absolute world position. Compute it from the wheel or
contact position minus the physics-root position.

Apply sustained responses as forces on every fixed step. Reserve impulses for
genuinely instantaneous events such as an explicit gameplay kick or a later
damage response. Do not write the dynamic entity's transform during ordinary
driving.

For a bounded passive airborne pitch policy, derive signed pitch from
`entity.forward.y`, project `rigidbody.angularVelocity` onto `entity.right`, and
calculate a critically damped proportional-derivative acceleration toward the
accepted small nose-up target. Clamp that acceleration, multiply by the local
X-axis pitch inertia, and submit the result through
`RigidBodyComponent.applyTorque` before the fixed world step. Gate the torque
on zero supported wheels and apply it only along the local pitch axis so yaw,
roll, linear momentum, and solver collision response remain untouched.

The controller should use PlayCanvas vectors at the adapter boundary but keep
its tuning, telemetry, and accepted state contracts as ordinary TypeScript
data.

## Direct Ammo Boundary

PlayCanvas exposes the underlying `rigidbody.body`, and its documentation
permits direct Ammo calls for capabilities absent from the component API. Keep
all such use inside a small, reviewed adapter.

Initially permitted uses are:

- setting an explicit inertia tensor and updating the body's inertia state,
- enabling and configuring continuous collision detection after collision
  tests establish appropriate thresholds, and
- a future support sweep only if raycasts fail accepted behavior.

Do not use direct Ammo calls for operations already supported by stable
PlayCanvas APIs. Do not leak Ammo objects into gameplay state, React state,
tests, or telemetry. Reuse or destroy temporary Ammo allocations explicitly.

Any new low-level use must document:

- why the public API is insufficient,
- the exact Ammo methods and build capability required,
- allocation and destruction ownership,
- version risk, and
- focused verification.

## Reset and Editor Manipulation

For a gameplay reset, use the rigid-body teleport API, explicitly clear linear
and angular velocity, clear controller integrators and low-speed state, and
activate the body.

Do not move an active dynamic body with ordinary entity transform setters. When
the editor manipulates the kart, pause or remove its physics participation,
edit the authoritative pose, and resume with an explicit synchronized reset.
The precise editor policy belongs to the project-system node once validated.

## Presentation Interpolation

The physics root remains at its latest completed simulation state. Interpolate
presentation-only transforms between the previous and current accepted physics
snapshots using the accumulator fraction. Never feed an interpolated visual
pose back into Ammo.

The chase camera may consume interpolated presentation state while gameplay,
collisions, recovery, and telemetry consume authoritative simulation state.

## Verification

The tool mapping is not validated until focused tests demonstrate:

1. Ammo loads from repository-owned paths in development and production builds.
2. The application does not construct physics components before Ammo is ready.
3. The outer loop produces the expected number of 60 Hz steps for synthetic
   30, 60, and 120 Hz frame sequences.
4. A long frame executes no more than the catch-up limit and reports dropped
   time.
5. The PlayCanvas rigid-body system advances exactly once per outer step.
6. Four filtered support rays return stable point, normal, fraction, and entity
   data on the test course without hitting the kart.
7. A force applied at a wheel offset creates the expected linear and angular
   response.
8. The compound root behaves as the intended center of mass.
9. Reset clears velocities and resumes from the authored pose.
10. React cancellation and teardown leave no animation frame, listeners, Ammo
    allocations, or PlayCanvas application alive.
11. Production build and supported-browser smoke tests pass without network
    access to an asset CDN.

Repeat these checks after PlayCanvas, Ammo, physics asset, or runtime-loop
changes. Behavior-level kart acceptance remains owned by the game-concept node.

## Known Limitations and Open Questions

- The owned outer loop is a deliberate deviation from PlayCanvas' default
  application tick and therefore needs exact-version pinning and regression
  tests.
- Browser rendering above 60 Hz requires presentation interpolation to avoid
  repeated visible physics poses.
- Ray support can miss narrow or abrupt geometry that a wheel-volume sweep
  would catch; measure before expanding the Ammo boundary.
- CCD values belong to collision mastery, not speculative physics setup.
- The mobile cost of four support queries, debug rendering, and future collision
  complexity must be measured on the representative scene.

## Sources

- [PlayCanvas `WasmModule` API](https://api.playcanvas.com/engine/classes/WasmModule.html)
- [PlayCanvas physics basics](https://developer.playcanvas.com/user-manual/physics/physics-basics/)
- [PlayCanvas compound shapes](https://developer.playcanvas.com/user-manual/physics/compound-shapes/)
- [PlayCanvas rigid-body system API](https://api.playcanvas.com/engine/classes/RigidBodyComponentSystem.html)
- [PlayCanvas forces and impulses](https://developer.playcanvas.com/user-manual/physics/forces-and-impulses/)
- [PlayCanvas direct Ammo integration and CCD](https://developer.playcanvas.com/user-manual/physics/calling-ammo/)
- [Ammo.js build referenced by PlayCanvas](https://github.com/kripken/ammo.js/commit/dcab07bf0e7f2b4b64c01dc45da846344c8f50be)
- [Bullet Physics user manual](https://github.com/bulletphysics/bullet3/blob/master/docs/Bullet_User_Manual.pdf)
