# Kart Physics System

## Purpose

This node documents the accepted Titan Racers kart-physics implementation. It
connects the engine-independent behavior in
`skills/game-concepts/kart-physics/README.md` with the PlayCanvas and Ammo
working methods in `skills/tools/playcanvas-ammo/README.md`.

The system owns deterministic simulation timing, the authoritative dynamic
chassis, wheel support and tire forces, presentation interpolation, physics
telemetry, and explicit reset behavior. Collision mastery and chase-camera
mastery remain separate systems and PR-sized units.

## Runtime Ownership

- `src/game/runtime/fixed-step-clock.ts` accumulates render time, advances the
  simulation at 60 Hz, caps catch-up work at four steps, and reports discarded
  time.
- `src/game/runtime/playcanvas-application.ts` loads the vendored Ammo build,
  disables PlayCanvas's default variable-cadence tick, owns the animation-frame
  loop, advances whole-world fixed steps, and renders once per display frame.
- `src/game/runtime/ammo-rigid-body.ts` owns direct Ammo rigid-body mass and CCD
  configuration. `src/game/runtime/ammo-wheel-sweep.ts` separately owns the
  reusable Ammo wheel-cylinder sweep allocations and returns copied hits.
- `src/game/kart/dynamic-kart-controller.ts` owns four-wheel support queries,
  suspension forces, grounded tire forces, steering, braking, reverse, rolling
  resistance, speed response, bounded zero-support pitch-stability torque, and
  physics telemetry.
- `src/components/solo-time-trial-canvas.tsx` constructs the compound chassis,
  models a 70 kg lower body plus a 50 kg rear cockpit mass, places the physics
  root at their combined center of mass, applies mass properties, connects input
  and tuning, snapshots authoritative poses, interpolates the offset
  presentation-only kart visual, drives the chase camera from that visual, and
  coordinates reset and editor transitions.
- `src/game/course/build-rough-course.ts` creates static rigid bodies and marks
  surfaces that may support the kart with the `drivable-surface` tag.
- `src/game/testing/scene-test-adapter.ts` exposes deliberate non-production
  pose, pause, step, support, load, slip, force, and signed airborne-pitch
  telemetry hooks for browser verification.

## Data And Update Flow

1. The outer animation-frame loop passes elapsed render time to the fixed-step
   clock.
2. For each required 1/60-second step, driving input enters the dynamic kart
   controller before PlayCanvas advances the whole Ammo world.
3. Each wheel sweeps a finite X-axis cylinder from maximum compression toward
   maximum droop. Collision groups restrict support to drivable surfaces.
4. A supported wheel calculates compression, damper velocity, non-negative
   normal load, contact-point velocity, longitudinal force, and lateral force.
   Combined tire force is limited by load and grip before being applied at the
   contact offset.
5. When all four wheels are unsupported, the controller derives signed pitch
   and local pitch rate, then applies a clamped critically damped torque toward
   a six-degree nose-up target. The policy changes neither linear velocity nor
   yaw/roll angular components.
6. PlayCanvas advances rigid-body motion and collision response. The resulting
   authoritative kart pose becomes the current presentation snapshot.
7. Once per display frame, the visual child interpolates between the previous
   and current snapshots. The chase camera follows this interpolated visual;
   gameplay, recovery, collision, and telemetry continue to consume the
   authoritative physics root.

## Accepted Invariants

- Gameplay physics advances at 60 Hz independently of render cadence.
- A frame stall cannot trigger an unbounded catch-up spiral.
- The kart is one dynamic six-degree-of-freedom compound rigid body with an
  explicit 120 kg mass, deliberate local inertia tensor, and combined center of
  mass about 20 cm rearward and 4.6 cm lower than the chassis visual origin.
- No ordinary driving path writes the authoritative dynamic transform.
- Each wheel independently gains and loses support; an unsupported wheel
  contributes no suspension or tire force.
- Each visible wheel hub, lower A-arm pair, and shock follows the same measured
  suspension travel that drives support force; presentation adds no canned
  chassis bounce.
- The visible chassis has intentional static ground clearance, and the smooth
  lateral wheel-guard envelope prevents deep barrier penetration without
  physical wheel bodies or joints.
- Suspension force is non-negative and bounded. Tire force scales with normal
  load and shares a combined grip limit across longitudinal and lateral demand.
- Braking stops forward motion before reverse drive engages.
- Partial support applies forces at the remaining wheel locations and never
  invokes an upright lock.
- Airborne motion preserves gravity, linear momentum, yaw/roll angular motion,
  and ordinary rigid-body contacts. A named, bounded pitch-only torque activates
  only at zero wheel support to prevent the accepted ramp from producing a hard
  nose dive.
- Pitch observability reports active state, signed angle, local rate,
  six-degree target, and applied torque; grounded samples must report the policy
  inactive.
- Reset teleports to the accepted start pose, clears linear and angular
  velocity and controller state, and reactivates the rigid body.
- Editor manipulation changes the kart to kinematic participation before
  transform edits and reapplies dynamic mass properties when gameplay resumes.
- Ammo objects never escape the low-level adapter, gameplay state, telemetry,
  React state, or tests.

## Verification

The accepted system is covered by:

- `tests/fixed-step-clock.spec.ts` for 30, 60, and 120 Hz equivalence, bounded
  catch-up work, and stall clamping;
- `tests/ammo-rigid-body.spec.ts` for chassis-local inertia calculation, mass
  scaling, and validated CCD configuration;
- `tests/playcanvas-runtime.spec.ts` for engine startup, default-tick
  cancellation, callback/update/render ordering, exact manual steps, listener
  cleanup, animation-frame cancellation, and idempotent teardown;
- `tests/home.spec.ts` for finite wheel support, visible clearance, springy ramp
  landing, full-speed signed airborne pitch and assist telemetry, static equilibrium, acceleration, configured top
  speed, braking, reverse, forward and reverse steering, longitudinal and
  lateral load transfer, grip saturation and recovery, wheel-specific ledge
  support, tipping, airborne rotation, landing, invalid-state recovery, tuning,
  editor transitions, loading failure/cancellation, and interpolated
  presentation/camera-target coherence;
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` for repository-wide static and
  production-build verification; and
- the desktop and mobile Playwright projects for supported-browser runtime,
  viewport, and synthetic physics regression coverage.

User-facing acceptance additionally requires driving the development build and
judging startup stability, acceleration, braking, reverse, steering, sliding,
ledge behavior, airborne motion, landing, and reset feel.

## Known Limits And Deferred Work

- Collision-envelope, impact-response, filtering, CCD, and contact-observation
  details live in the sibling collision project-system node.
- The chase camera now consumes interpolated presentation state, but deliberate
  response to velocity, orientation, slip, impacts, and airborne state belongs
  to chase-camera mastery.
- Surface grip is currently uniform rather than authored per material.
- There is no automatic stuck-timer recovery. The current automatic path covers
  an invalid fall threshold, while deliberate resets are immediate.
- Player air control, anti-roll, and yaw stabilization are not present. The sole
  airborne assist is the accepted passive pitch-stability torque; any expansion
  requires separately accepted policy and observability.
- Mobile viewport rendering and synthetic physics scenarios are covered, but a
  playable touch-driving path does not exist yet. Touch playability is deferred
  to PR 4, representative device performance acceptance to the public-demo
  polish phase, and narrow-screen editor object picking to protected course
  tooling.
