# Kart Physics System

## Purpose

This node maps the shipped Titan Racers kart-physics implementation. It
connects the engine-independent
[`kart-physics`](../../game-concepts/kart-physics/README.md) standard with the
[`PlayCanvas and Ammo`](../../tools/playcanvas-ammo/README.md) mapping.

`docs/kart-system/` is the authority for the layered handling architecture,
derivation formulas, shared gameplay policy and its values, runtime solver
details, units, and versioning. This node covers source ownership, data flow,
and the rules that must hold. Collisions and the chase camera are sibling
systems.

## Runtime Ownership

- `src/game/runtime/fixed-step-clock.ts`: 120 Hz accumulator, 100 ms frame
  clamp, eight-step catch-up cap, discarded-time reporting.
- `src/game/runtime/playcanvas-application.ts`: vendored Ammo loading, owned
  animation loop replacing PlayCanvas's tick, whole-world fixed steps, one
  render per display frame.
- `src/game/runtime/ammo-rigid-body.ts` and `ammo-wheel-sweep.ts`: the only
  direct-Ammo code (inertia, CCD, wheel cylinder sweeps), returning copied data.
- `src/game/kart/dynamic-kart-controller.ts`: per-wheel support, suspension,
  tire forces, steering, braking, reverse, resistance, and physics telemetry.
  No target-seeking torque while unsupported.
- Engine-independent laws, each in its own module under `src/game/kart/`:
  `kart-drive-model` (motor force, equal driven-wheel split, symmetric reverse),
  `kart-brake-model` (service brake and independent handbrake),
  `kart-coasting-model` (rolling and aerodynamic resistance),
  `kart-tire-model` (slip angle, load-derived cornering stiffness, peak-to-slide
  curve, combined budget, near-zero blend), `kart-suspension-model` (spring,
  damper, progressive bump), `kart-steering` (speed-limited request envelope),
  `kart-rest-settling` and `kart-grounded-roll-damping` (shared low-energy and
  grounded stabilization policy), `kart-righting` (manual self-righting),
  `kart-principal-axes` (inertia diagonalization), `kart-drift-smoke`
  (presentation-only scrub-power smoke), and `kart-surface-effects`
  (presentation-only tire marks and grass clippings, see
  [scene lighting](../scene-lighting/README.md)).
- `src/game/kart/kart-derivation.ts` resolves a kart document into the
  persisted snapshot, including wheel stations, mass properties, and the
  `KartPhysicalProfile` (`kart-physical-profile.ts`) that runtime subsystems
  consume. See the [kart builder](../kart-builder/README.md) system.
- `src/game/kart/kart-reference-construction.ts`: the reference RC scale
  helpers and fixture that size shared, kart-independent policy (camera
  framing, smoke, CCD reference). Per-kart wheels and mass come from derivation.
- `src/game/physics/world-environment.ts`: Earth gravity and air density.
  `src/game/kart/tire-surface-interaction.ts`: the registered tire/surface
  interaction lookup. `course-surface-resolver.ts` resolves authored collider
  materials independently at each wheel hit (including coplanar layers).
- `src/game/kart/kart-development-values.ts`: flat adapter with ownership
  metadata. Runtime builds its owner-specific profiles from the resolved
  snapshot through it; only non-production test hooks can override (and
  clamp) values, so production races use the snapshot exactly.
- `src/components/solo-time-trial-canvas.tsx`: builds the compound chassis from
  the resolved snapshot (center-of-mass root, principal-axis physics frame,
  assembly-frame child), wires input and profiles, interpolates presentation,
  drives the camera, and coordinates reset and debug teleports.
- `src/components/kart-stats-drawer.tsx`: `KartStatsDrawer`, the read-only
  "Kart stats" panel showing the selected kart's derived evidence, toggled with
  unmodified `T` during an active race (no touch access).
- `src/game/testing/scene-test-adapter.ts`: non-production pose, step, and
  telemetry hooks.

## Data Flow

1. The animation loop passes elapsed time to the fixed-step clock.
2. Before each 1/120 s step, sampled input enters the controller.
3. Each wheel sweeps a cylinder from maximum compression to maximum droop
   against drivable surfaces only; the hit primitive's authored up axis defines
   its drivable face.
4. Each supported wheel computes compression, damper velocity along the strut
   axis, non-negative load, contact velocity, and drive, brake, and lateral
   force, clamped to one combined budget and applied at the contact point.
5. Unsupported wheels contribute nothing; with all four unsupported only
   gravity, aerodynamic drag, momentum, low solver damping, and collisions act.
6. PlayCanvas advances the Ammo world once; the resulting pose becomes the
   current snapshot.
7. Each display frame interpolates the visual child between snapshots; the
   camera follows the visual while gameplay, recovery, collisions, and telemetry
   use the physics root.

## Accepted Invariants

- Physics runs at 120 Hz independent of render cadence, and stalls cannot
  cause a catch-up spiral.
- The kart is one dynamic compound body with derived mass, center of mass, and
  full inertia tensor; Ammo receives the principal moments, never a
  diagonal-only assembly approximation.
- Driving never writes the dynamic transform.
- Each wheel gains and loses support independently, and the active contact
  hull decides tipping.
- Hubs, arms, and shocks follow the same suspension travel that produces
  force. There is no canned bounce.
- Suspension force is non-negative and bounded by finite travel, with no
  per-wheel force cap.
- Motor and brake forces are never multiplied by mass. Brake stops forward
  motion before reverse engages, and reverse mirrors forward.
- Coasting uses explicit rolling and aerodynamic forces with drag area derived
  from geometry. Rigid-body linear damping is zero.
- Braking does not shrink grip, taper brake force, shorten the lateral force
  lever, or reduce rear stiffness. Handbrake is rear braking only, and drift is
  a continuous tire state.
- Steering is limited by the derived grip/rollover boundary with Ackermann
  per-wheel angles. Visual pivots, sweeps, tire axes, and telemetry share the
  same angle.
- Shared policy (steering margin and response, trailing-axle grip margin,
  near-zero tire blend, rest settling, grounded roll damping, righting, solver
  damping, CCD ratios) is identical for every kart and lives outside kart
  documents. Values are in `docs/kart-system/gameplay-policy.md`.
- Ramp flight has no target-seeking pitch or upright controller.
- Below-course falls and upright reset requests use race-session checkpoint
  recovery. A manual recovery request on a kart at least 120° inverted just
  above a drivable surface instead applies bounded roll and lift impulses in
  place, with a 450 ms cooldown and enough lift to clear the collision hull.
  Keyboard `R`, controller south face, the touch recovery control, and a direct
  tap on the inverted kart all request it.
- Tire smoke, tire marks, and grass clippings are presentation only and never
  feed back into grip. Wheel telemetry's contact point exists only for them.
- Opening the stats drawer clears driving input and removes touch-driving
  controls while open. It cannot override any value.
- Ammo objects never escape the low-level adapters.

## Verification

- Model unit specs: `tests/kart-drive-model.spec.ts`,
  `kart-brake-model.spec.ts`, `kart-coasting-model.spec.ts`,
  `kart-tire-model.spec.ts`, `kart-suspension-model.spec.ts`,
  `kart-righting.spec.ts`, `kart-rest-settling.spec.ts`,
  `kart-principal-axes.spec.ts`, `kart-drift-smoke.spec.ts`,
  `kart-surface-effects.spec.ts`,
  `kart-tuning.spec.ts`, and `dynamic-kart-controller.spec.ts` (steering,
  reverse symmetry, Ackermann).
- Runtime: `tests/fixed-step-clock.spec.ts`, `tests/playcanvas-runtime.spec.ts`,
  `tests/ammo-rigid-body.spec.ts`.
- Browser smoke in `tests/home.spec.ts`: acceleration, steering, brake into
  reverse, Handling Kart launch, reset, manual righting, landing, recovery,
  stats drawer.
- Manual QA only (no automated coverage): the Handling Kart bump-landing fix
  and runtime coupled-inertia handoff, plus overall driving feel (stability,
  braking, sliding, ledges, airborne, landing, reset).

## Known Limits

- Only one tire compound exists, so runtime doesn't read it per kart.
- No automatic stuck-timer recovery; inverted karts on support need a manual
  request.
- No player air control, anti-roll bar, yaw stabilization, or airborne pitch
  assist. Grounded stabilization is limited to rest settling and grounded
  roll/heave damping.
- Representative mobile performance is deferred to Phase 9.
