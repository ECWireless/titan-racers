# PlayCanvas and Ammo

**Maturity:** Validated. The runtime, physics integration, and kart
implementation passed their agreed browser and gameplay verification and were
accepted by the feature lead on 2026-07-10.

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

- [`race-progression/`](race-progression/README.md): accepted PlayCanvas 2.20.6
  mapping for fixed-step race lifecycle, directed gate crossings,
  discarded-time charging, version-two course normalization, and supported
  checkpoint recovery.
- [`course-editing/`](course-editing/README.md): accepted PlayCanvas 2.20.6
  mapping for validated course documents, primitive construction, semantic
  collision roles, fixture gating, and collision debug geometry.
- [`chase-camera/`](chase-camera/README.md): accepted PlayCanvas 2.20.6 mapping
  for motion-led chase-camera state, collision-observer impulses, obstruction
  raycasts, presentation interpolation, and camera-focused verification.
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
3. Call `app.update(1 / 120)`, which advances the PlayCanvas systems and one
   Ammo/Bullet step.
4. Run registered post-physics callbacks and capture the resulting state.
5. Stop after the configured catch-up limit, initially four steps, and record
   any discarded whole-step time.
6. Render once per browser frame and pass the accumulator fraction to
   presentation interpolation.

Configure the PlayCanvas rigid-body system with the same `1 / 120` fixed
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

Keep authored wheel centers, radius, width, driven role, and steered role in
ordinary validated data before constructing PlayCanvas entities or Ammo sweep
shapes. Use those same values for support queries, visual wheels, steering
directions, drivetrain allocation, suspension presentation, and collision
protection so geometry cannot disagree across systems. Do not infer additional
grip from sweep width; the tire-force envelope remains load and compound based.

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

Submit authored motor capability to the rigid body as total driven-wheel force
in newtons, divided across supported driven wheels before the shared tire-force
clamp. Do not multiply that force by rigid-body mass to preserve a target
acceleration: Ammo already derives linear acceleration from applied force and
mass. Keep speed falloff and the shared brake-to-reverse transition policy in
ordinary TypeScript so their causal relationship remains testable without
Ammo. A reversible motor with unchanged gearing uses the same force and
no-load speed magnitudes in either direction; the controller changes only the
sign after forward motion falls inside the named near-zero threshold.

Submit service-brake capability as a total force in newtons. Proportion its
current request across supported braked wheels by measured normal load before
the shared tire-force clamp. Do not
multiply a target deceleration by rigid-body mass. Keep analog demand, future
brake-torque-to-wheel-radius derivation, and any accepted brake distribution
policy in engine-independent TypeScript; Ammo should receive only the resolved
per-wheel forces and derive deceleration from mass.

Submit the handbrake through the same path as an independent total actuator
force distributed only across the configured rear handbraked wheels. Do not
derive it as a percentage of service-brake force; future torque-to-radius
derivation belongs to the respective brake hardware before this adapter.

Divide total motor demand equally across all configured driven wheels. Resolve
support, suspension load, and each wheel's force limit before applying its
fixed share. Cap that share at the wheel limit and discard any unused amount;
the Demo v1 drivetrain does not transfer it to another wheel. Submit the
resulting longitudinal force through the ordinary per-wheel combined
tire-force clamp so drive cannot bypass lateral demand or manufacture traction.

Apply rolling resistance through the ordinary per-wheel longitudinal force
path using the measured suspension load. Apply aerodynamic resistance as a
chassis force opposite planar velocity, independent of throttle and wheel
support, with magnitude proportional to speed squared. Keep air density and
the near-zero rolling regularization as shared TypeScript policy. Do not also
enable per-kart PlayCanvas linear damping: it overlaps the explicit forces and
hides their physical ownership. Any engine-level damping retained solely for
solver stability must be a fixed, documented adapter policy rather than kart
authored data.

For the demo's front/rear handling balance, apply the shared rear-axle safety
ratio to the load-scaled grip envelope before clamping the combined longitudinal
and lateral tire force. Keep suspension load, point velocity, slip angle, and
force application physical; do not emulate stability by writing yaw velocity
or injecting a counter-torque. Brake and handbrake requests still share the
adjusted combined-force envelope and can produce rear breakaway. Do not shrink
the grip coefficient from brake input without observed wheel slip, and do not
expose this recovery policy through per-kart tuning.

Request ordinary lateral tire force as signed slip angle times load-aware
cornering stiffness in N/rad, then clamp the combined vector to the load-scaled
grip envelope. Derive stiffness per contact as resolved peak grip coefficient
times current suspension load divided by peak-slip angle. Do not multiply
cornering stiffness by raw lateral velocity: that
silently makes an equal slip angle request more force at higher speed. Near
zero rolling speed, where slip angle is poorly conditioned, blend to the shared
bounded lateral-velocity settling policy before applying the same tire envelope.

Apply both longitudinal and lateral tire forces at the resolved wheel contact
point. Never shorten the lateral-force lever toward the center of mass under
braking; that suppresses physical yaw torque and disguises a tire-force or
balance problem. Likewise, do not delete rear cornering stiffness under hard
braking; rear-only handbrake force already produces physical axle imbalance
through the combined tire envelope.

Resolve the maximum requested wheel angle in engine-independent code from
nominal center-of-mass height, track width, wheelbase, peak grip, gravity,
current signed speed magnitude, mechanical steering lock, and the shared
steering-request margin. Pass the resulting angle into the per-wheel steering
geometry; do not use Ammo damping, yaw writes, or an authored high-speed angle
to manufacture stability. Surface-specific loss of grip remains a tire-force
outcome rather than dynamically shrinking steering authority.

Approach the requested angle at `current permitted angle / shared response
duration` per second. Keep that normalized duration in controller policy, not
kart tuning, until a physical steering actuator is modeled. The rigid body then
derives chassis yaw response from the resulting per-wheel tire forces and yaw
leverage; wheel-angle response must never write yaw velocity directly.

Before each steered-wheel support sweep and tire-force calculation, convert the
center-equivalent request into that wheel's Ackermann angle using wheelbase and
its lateral offset from the steered-axle centerline. Use the same resolved angle
for the visual wheel pivot, swept support shape, longitudinal/lateral contact
axes, and diagnostics. Identical front-wheel angles are not an acceptable
shortcut because they imply conflicting turn centers and create avoidable tire
scrub.

Expose both the center-request geometric radius and the solver-observed chassis
radius in developer diagnostics. Derive the latter from forward speed divided
by angular velocity projected onto the kart's local up axis. These are
observations only: do not use either readout to overwrite rigid-body yaw or
velocity.

When every wheel is unsupported, submit no suspension, tire, or
attitude-seeking controller force. Let Ammo preserve the launch velocity and
angular velocity under gravity, shared low numerical damping, aerodynamic
forces if modeled, and ordinary collision response. Tune an unacceptable ramp
launch through authored construction—such as spring rate, support geometry,
mass distribution, and inertia—and verify the support-to-airborne transition
with telemetry rather than aiming the body at a target angle.

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

Manual self-righting is not a gameplay reset. Keep it on the public PlayCanvas
rigid-body API: verify a nearby `drivable-surface` with the established filtered
raycast, calculate the shortest stable world-space roll axis toward upright,
then use `applyTorqueImpulse` plus a small bounded upward `applyImpulse` at the
fixed-step boundary. Preserve the current transform and velocities, activate
the body, and use a time-bounded re-arm guard so repeated action edges cannot
stack into an unintended launch. At the exactly inverted singularity, use a
stable chassis-forward roll axis rather than producing a zero or non-finite
cross product.

A coarse-pointer kart tap first converts CSS coordinates into render-target
coordinates, projects a near-to-far camera ray with `screenToWorld`, and accepts
only a filtered hit on the kart rigid-body root. Keep pointer duration and
movement thresholds in the browser adapter. The accepted hit queues the same
semantic manual-recovery edge as keyboard, controller, and the explicit touch
button; it never applies physics from a DOM event.

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
3. The outer loop produces the expected number of 120 Hz steps for synthetic
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
- Render cadence remains decoupled from 120 Hz physics; presentation
  interpolation avoids
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
- [PlayCanvas `RigidBodyComponent` API](https://api.playcanvas.com/engine/classes/RigidBodyComponent.html)
- [PlayCanvas direct Ammo integration and CCD](https://developer.playcanvas.com/user-manual/physics/calling-ammo/)
- [Ammo.js build referenced by PlayCanvas](https://github.com/kripken/ammo.js/commit/dcab07bf0e7f2b4b64c01dc45da846344c8f50be)
- [Bullet Physics user manual](https://github.com/bulletphysics/bullet3/blob/master/docs/Bullet_User_Manual.pdf)
