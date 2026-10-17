# PlayCanvas and Ammo

**Maturity:** Validated (accepted 2026-07-10).

## Purpose and Scope

This node maps the engine-independent
[`kart-physics`](../../game-concepts/kart-physics/README.md) standard onto the
PlayCanvas Engine and its Ammo.js/Bullet integration. Read it before changing
physics loading, application stepping, rigid bodies, collision shapes, support
queries, force application, mass properties, CCD, or physics reset behavior.

It owns reusable engine behavior and constraints. Titan Racers source
ownership lives in
[`project-systems/kart-physics`](../../project-systems/kart-physics/README.md).

## Focused Children

- [`wheel-suspension/`](wheel-suspension/README.md): direct-Ammo cylinder wheel
  sweeps, filtering, and visible-suspension presentation.
- [`collisions/`](collisions/README.md): collision geometry, contact
  observation, material combining, and CCD.
- [`chase-camera/`](chase-camera/README.md): camera state, collision-driven
  impulses, obstruction raycasts, and interpolation.
- [`course-editing/`](course-editing/README.md): course construction,
  semantic collision roles, lighting, gizmos, picking, and collision
  diagnostics.
- [`race-progression/`](race-progression/README.md): fixed-step lifecycle,
  directed gate crossings, discarded-time charging, and supported recovery.

## Supported Baseline

- PlayCanvas Engine `2.20.6`, pinned exactly because the runtime replaces the
  default application tick.
- The Ammo.js/Bullet build vendored by the repository, with glue, WebAssembly,
  and fallback files self-hosted; no runtime CDN. Record upstream revision,
  license, paths, and hashes beside the vendored files.
- One world unit is one metre; use SI units wherever the API allows.

Upgrading PlayCanvas or Ammo is a deliberate tool change that must repeat the
runtime and physics verification below.

## Loading Ammo

Configure the module with `pc.WasmModule.setConfig("Ammo", …)` and await
`pc.WasmModule.getInstance` before starting the application. A load failure is
an explicit initialization error. Never create collision or rigid-body
components before Ammo is ready.

## Fixed-Step Runtime Ownership

PlayCanvas passes variable frame time to its update, and gameplay callbacks do
not run once per internal Bullet substep. That is insufficient for a kart whose
support queries and forces must be recomputed every physics step, so Titan
Racers owns the outer loop:

1. Accumulate browser-frame time, clamped to 100 ms per frame.
2. Before each whole step, sample input and run pre-physics callbacks.
3. Call `app.update(1 / 120)`; the rigid-body system is configured with the
   same `fixedTimeStep` and `maxSubSteps = 1`, so each call advances Ammo once.
4. Run post-physics callbacks and capture state.
5. Stop after eight catch-up steps and report discarded time.
6. Render once per browser frame, passing the accumulator fraction to
   presentation interpolation.

Gameplay code receives fixed-step callbacks and never calls
`requestAnimationFrame`, `app.update`, `app.render`, or Bullet stepping.
Initialization and teardown must stay safe when a React effect is cancelled
during async Ammo loading, and the application is destroyed exactly once.

## Rigid Bodies and Collision Shapes

The kart is a dynamic rigid body with all linear and angular factors enabled
and a compound collision shape. The compound root is the physical center of
mass, so place it deliberately and offset visual children relative to it. Do
not use wheel bodies or `btRaycastVehicle`.

Course geometry uses static bodies with primitive or compound shapes. Classify
drivable surfaces separately from obstacles through tags and collision groups;
surface grip is project data, not Ammo contact friction. Avoid dynamic concave
meshes.

## Wheel Support

Wheel support uses a direct-Ammo cylinder `convexSweepTest` per wheel; see
[`wheel-suspension/`](wheel-suspension/README.md). Compute contact-point velocity
in TypeScript from linear velocity plus angular velocity crossed with the
center-to-contact offset. Wheel centers, radius, width, and roles come from one
validated data source shared by support, visuals, steering, and drivetrain
(and any future wheel collision protection).

## Applying Forces

- Use `RigidBodyComponent.applyForce(force, relativePoint)` for suspension and
  tire forces every fixed step. The point is a world-space offset from the body
  origin, not an absolute position.
- Submit forces in newtons. Never multiply by rigid-body mass to hit a target
  acceleration; Ammo already derives acceleration from force and mass.
- Apply aerodynamic drag as a chassis force; apply rolling resistance through
  the per-wheel longitudinal path. Do not also enable per-kart PlayCanvas linear
  damping. Any engine damping kept for solver stability is fixed shared policy.
- Keep force laws, allocation, steering, and tire budgets in engine-independent
  TypeScript so they are testable without Ammo; pass only resolved per-wheel
  forces and angles to the engine.
- With every wheel unsupported, submit no suspension, tire, or attitude-seeking
  force.
- Use impulses only for discrete events (manual righting, a future damage
  response) and for the shared grounded stabilization policies documented in
  `docs/kart-system/gameplay-policy.md`. Never write a dynamic entity's
  transform during driving.

## Direct Ammo Boundary

PlayCanvas exposes `rigidbody.body` for capabilities absent from the component
API. Keep all such use inside small reviewed adapters. Current uses:

- explicit inertia tensor and inertia update (`ammo-rigid-body.ts`);
- CCD threshold and swept-sphere radius (`ammo-rigid-body.ts`); and
- wheel cylinder sweeps (`ammo-wheel-sweep.ts`).

Do not leak Ammo objects into gameplay state, React, tests, or telemetry. Reuse
or destroy allocations explicitly. Any new low-level use documents why the
public API is insufficient, the exact methods required, allocation ownership,
version risk, and focused verification.

## Reset, Righting, and Test Poses

- **Reset:** use the rigid-body `teleport`, clear linear and angular velocity,
  clear controller transient state, and activate the body.
- **Manual righting:** stays on the public API. Confirm nearby
  `drivable-surface` support with a filtered raycast, compute the shortest roll
  axis toward upright (falling back to a stable chassis axis at the exactly
  inverted singularity), then apply `applyTorqueImpulse` plus a bounded upward
  `applyImpulse` at the fixed-step boundary, with a time-bounded re-arm guard.
- **Kart tap:** convert CSS coordinates to render-target coordinates, project a
  ray with `screenToWorld`, and accept only a filtered hit on the kart root. The
  hit queues the same semantic righting request as other inputs; physics is
  never applied from a DOM event.
- **Test and debug poses:** never move an active dynamic body with transform
  setters; use `teleport` with velocity and controller reset. If a future flow
  changes body type, PlayCanvas recreates the body and resets collision
  filters, so filters, mass properties, and CCD must be reapplied.

## Presentation Interpolation

The physics root holds the latest completed simulation state. Interpolate
presentation-only transforms between the previous and current snapshots using
the accumulator fraction, and never feed an interpolated pose back into Ammo.
The chase camera consumes interpolated presentation; gameplay, collisions,
recovery, and telemetry consume authoritative state.

## Verification

After PlayCanvas, Ammo, physics asset, or runtime-loop changes, confirm: Ammo
loads from repository paths in development and production with no CDN; no
physics component exists before Ammo is ready; synthetic 30, 60, and 120 Hz
frame sequences produce the expected step counts; long frames respect the
catch-up cap and report dropped time; the rigid-body system advances once per
outer step; and teardown leaves no animation frame, listener, Ammo allocation,
or application alive. `tests/playcanvas-runtime.spec.ts` and
`tests/fixed-step-clock.spec.ts` cover the loop.

## Known Limitations

- The owned outer loop deviates from PlayCanvas' default tick, so exact version
  pinning and regression tests are required.
- Mobile cost of wheel sweeps and collision complexity still needs
  representative-device measurement (Phase 9).

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
