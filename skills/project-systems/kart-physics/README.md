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
- `src/game/runtime/ammo-rigid-body.ts` is the only direct Ammo boundary. It
  calculates a chassis-local box inertia tensor, applies it to the underlying
  rigid body, updates the tensor, activates the body, and destroys its temporary
  Ammo allocation before returning.
- `src/game/kart/dynamic-kart-controller.ts` owns four-wheel support queries,
  suspension forces, grounded tire forces, steering, braking, reverse, rolling
  resistance, speed response, and physics telemetry.
- `src/components/solo-time-trial-canvas.tsx` constructs the compound chassis,
  applies mass properties, connects input and tuning, snapshots authoritative
  poses, interpolates the presentation-only kart visual, drives the chase camera
  from that interpolated visual, and coordinates reset and editor transitions.
- `src/game/course/build-rough-course.ts` creates static rigid bodies and marks
  surfaces that may support the kart with the `drivable-surface` tag.
- `src/game/testing/scene-test-adapter.ts` exposes deliberate non-production
  pose, pause, step, support, load, slip, and force telemetry hooks for browser
  verification.

## Data And Update Flow

1. The outer animation-frame loop passes elapsed render time to the fixed-step
   clock.
2. For each required 1/60-second step, driving input enters the dynamic kart
   controller before PlayCanvas advances the whole Ammo world.
3. Each wheel raycasts from its real chassis-relative location toward the
   suspension direction and accepts only tagged drivable surfaces.
4. A supported wheel calculates compression, damper velocity, non-negative
   normal load, contact-point velocity, longitudinal force, and lateral force.
   Combined tire force is limited by load and grip before being applied at the
   contact offset.
5. PlayCanvas advances rigid-body motion and collision response. The resulting
   authoritative kart pose becomes the current presentation snapshot.
6. Once per display frame, the visual child interpolates between the previous
   and current snapshots. The chase camera follows this interpolated visual;
   gameplay, recovery, collision, and telemetry continue to consume the
   authoritative physics root.

## Accepted Invariants

- Gameplay physics advances at 60 Hz independently of render cadence.
- A frame stall cannot trigger an unbounded catch-up spiral.
- The kart is one dynamic six-degree-of-freedom compound rigid body with an
  explicit 120 kg mass and deliberate local inertia tensor.
- No ordinary driving path writes the authoritative dynamic transform.
- Each wheel independently gains and loses support; an unsupported wheel
  contributes no suspension or tire force.
- Suspension force is non-negative and bounded. Tire force scales with normal
  load and shares a combined grip limit across longitudinal and lateral demand.
- Braking stops forward motion before reverse drive engages.
- Partial support applies forces at the remaining wheel locations and never
  invokes an upright lock.
- Airborne motion preserves gravity, linear momentum, angular momentum, and
  ordinary rigid-body contacts.
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
- `tests/ammo-rigid-body.spec.ts` for chassis-local inertia calculation and
  mass scaling;
- `tests/playcanvas-runtime.spec.ts` for engine startup, default-tick
  cancellation, callback/update/render ordering, exact manual steps, listener
  cleanup, animation-frame cancellation, and idempotent teardown;
- `tests/home.spec.ts` for static equilibrium, acceleration, configured top
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

- Collision behavior is only the engine baseline. Barriers, corners, ramps,
  glancing impacts, snagging, bounce, spin, tunneling, CCD thresholds, and
  collision telemetry belong to collision mastery.
- The chase camera now consumes interpolated presentation state, but deliberate
  response to velocity, orientation, slip, impacts, and airborne state belongs
  to chase-camera mastery.
- Surface grip is currently uniform rather than authored per material.
- There is no automatic stuck-timer recovery. The current automatic path covers
  an invalid fall threshold, while deliberate resets are immediate.
- Air control, anti-roll, yaw stabilization, and other arcade assists are not
  present. Add them only through a separately accepted policy if hands-on tuning
  proves they are needed.
- Mobile viewport rendering and synthetic physics scenarios are covered, but a
  playable touch-driving path does not exist yet. Touch playability is deferred
  to PR 4, representative device performance acceptance to the public-demo
  polish phase, and narrow-screen editor object picking to protected course
  tooling.
