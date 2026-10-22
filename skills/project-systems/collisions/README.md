# Collision System

## Purpose

This node documents the accepted Titan Racers collision implementation. It
combines the behavior contract in
[`game-concepts/collisions`](../../game-concepts/collisions/README.md), the
finite-wheel extension in
[`game-concepts/kart-physics/wheel-suspension`](../../game-concepts/kart-physics/wheel-suspension/README.md),
and the PlayCanvas/Ammo working methods in
[`tools/playcanvas-ammo/collisions`](../../tools/playcanvas-ammo/collisions/README.md)
and
[`tools/playcanvas-ammo/wheel-suspension`](../../tools/playcanvas-ammo/wheel-suspension/README.md).

The system owns gameplay collision geometry, participation filtering, ordinary
solver response, copied contact observation, targeted high-speed CCD,
collision-response test telemetry, and the collision-focused rough-course
fixtures. It does not own tire-force policy, chase-camera impact behavior,
multiplayer kart contact policy, or general recovery-system expansion.

## Runtime Ownership

- `src/game/physics/collision-groups.ts` defines the explicit kart, drivable
  surface, solid obstacle, and wheel-support group/mask contract.
- `src/game/collision/kart-collision-model.ts` owns the default whole-body
  construction material, collision-envelope measurement, shared numerical
  angular damping, and geometry-to-CCD derivation policy.
- `src/components/solo-time-trial-canvas.tsx` builds the compound kart body
  from the snapshot's derived collision primitives, applies body material and
  derived CCD values, and wires the contact observer, suspension presentation,
  and copied debug summaries.
- `src/game/collision/kart-collision-observer.ts` snapshots pre-step kart state,
  copies pooled global contact data, orients normals consistently toward the
  kart, reconstructs pre-solve point approach speed, and aggregates one
  post-solve collision frame per fixed step.
- `src/game/runtime/ammo-rigid-body.ts` validates, applies, and retains ordinary
  TypeScript copies of the Ammo CCD threshold and swept-sphere radius.
- `src/game/runtime/ammo-wheel-sweep.ts` owns and reuses the direct-Ammo
  cylinder-sweep allocations used by finite wheel support.
- `src/game/runtime/playcanvas-application.ts` provides distinct pre-physics
  and post-physics fixed-step callbacks so collision observation brackets the
  Ammo solve.
- `src/game/course/rough-course.v4.json` defines the accepted sparse play
  course: two cylinder obstacles, a tall jump ramp beside the lap, low ramps
  on the lap (kicker, bridge, inspection table), and controlled straight, thin-wall,
  convex-corner, and concave-corner impact fixtures. The validated
  `build-rough-course.ts` projection creates their simple static rigid bodies
  with explicit filtering. Diagnostic walls are constructed only when
  non-production test hooks and the deliberate `?collision-fixtures` route are
  both active; they cannot appear in production or the normal course.
- `src/game/testing/scene-test-adapter.ts` exposes test-only controlled poses,
  exact manual steps, wheel/suspension state, CCD configuration and deliberate
  disabled baseline, contacted entity names, approach speed, impulse, and
  pre/post velocity summaries.

## Geometry And Material Policy

Each kart is one six-degree-of-freedom dynamic compound body. Its collision
compound is the authored parts marked `collision: "solid"` (boxes and
cylinders), derived into the resolved snapshot by `kart-derivation.ts`. The
official karts collide with their chassis plate and upper housing; bumpers and
other parts are visual only.

Derivation also adds one collision-only wheel-guard box (`geometry.wheelGuard`)
spanning the outer tire faces and the front/rear tire edges, from wheel-center
height to tire top. It stops tires passing through walls on side, head-on, and
corner hits. Its bottom stays inside the tire profile, so floors and ramps still
meet the tires first and ground clearance is unchanged. The guard is not
authored and carries no mass; steering clearance, drag area, player stats, the
wheel-overlap check, and the runtime clearance datum ignore it. Walls lower than
wheel center can still pass under it. Snapshots older than v3 have no guard and
run with authored colliders only.

The visible tires, hubs, A-arms, and shocks are presentation children rather
than separately simulated rigid bodies. Their vertical motion comes from the
same finite cylinder sweeps and suspension travel that apply forces to the
chassis. This avoids joint instability and exposed detail colliders while
keeping the visible and physical silhouettes coherent.

Course floors, ramps, and the two cylinders use deliberately simple static
primitives. Each ramp is an aligned box with no separate base or crest lip,
and the tall jump is sunk so its entry edge is flush with the floor; any step
taller than the wheel radius stops karts dead. The diagnostic straight wall
and 0.1 m thin wall are opt-in automated-test geometry, so normal play
contains no invisible or off-course collision traps.

All karts share the default whole-body friction `0.12` and restitution `0.04`
from `kart-collision-model.ts`. PlayCanvas compound children share one parent rigid-body
material, so this is an explicit current engine limitation rather than
per-primitive response. Static drivable surfaces and solid obstacles use zero
restitution, so Ammo's multiplicative combiner produces zero ordinary rebound.
Shared solver policy supplies low `0.08` angular damping for numerical
stability, while rigid-body linear damping is zero because explicit rolling
resistance and aerodynamic drag own coasting. None of these values is exposed
as a raw kart-tuning override. Grounded grip continues to come from the wheel
controller rather than chassis contact friction. No arcade collision impulse or
contact-time orientation assist is active, and the kart applies no airborne
attitude torque.

## Fixed-Step Data Flow

1. Before each 120 Hz world step, the collision observer clears the previous
   contact list and copies kart position plus linear and angular velocity.
2. The kart controller sweeps four wheel-sized cylinders only against the
   drivable-surface group, calculates suspension and tire forces, and submits
   them at stable wheel-center force points.
3. Ammo advances the dynamic compound kart against drivable surfaces and solid
   obstacles. Its solver remains authoritative for non-penetration, sliding,
   rebound, and impact rotation.
4. PlayCanvas emits global contact events after solving. The observer copies
   every required number and vector immediately because the engine pools those
   event objects.
5. The post-physics callback aggregates the copied contacts with the post-solve
   kart velocities. Test telemetry retains only ordinary copied data for the
   controlled scenario.
6. Presentation interpolation renders the authoritative poses and wheel travel
   without feeding visual state back into collision response.

## Continuous Collision Detection

Derivation records each kart's smallest relevant collision cross-section (the
smallest box dimension or cylinder diameter/height among solid parts and the
wheel guard). Shared
policy in `kart-collision-model.ts` sets the Ammo swept-sphere radius to half
that cross-section and the CCD motion threshold to 75% of the radius. Values are
applied after the Ammo body exists and copied for telemetry.

At 120 Hz a 17 m/s kart moves about 0.142 m per step. The controlled safety case
drives at 20.4 m/s into a 0.1 m static barrier (`tests/home.spec.ts`). CCD is
defense in depth, not a replacement for honest collider thickness.

The open official chassis (PR 4.1.4) has 2 mm plates, so its sweep radius is
1 mm and CCD sweeps on nearly every step. That costs nothing measurable on the
reference iPhone, and forcing a 35 mm radius did not change the
barrier result. The center sphere cannot protect a leading face 0.2 m ahead.

## Speed-Adaptive Substeps

Each fixed step chooses Bullet's internal substep count from the kart's
pre-step motion: `selectKartPhysicsSubsteps` picks the smallest power of two
(cap 8) at which the fastest collider point, `|v| + |ω|·reach`, travels at most
0.05 m per substep (half the thinnest 0.1 m obstacle). `reach` is the farthest
collision hull corner from the center of mass. That is 1 substep up to about
6 m/s, 2 to 12 m/s, and 4 through top speed and the 20.4 m/s safety case.
`PlayCanvasRuntime.setPhysicsSubsteps` applies the count before each
`app.update`; the wheel sweeps and controller still run once per fixed step.
See the [Ammo internal-substep notes](../../tools/playcanvas-ammo/collisions/README.md#internal-substeps)
for why forces persist and why counts are powers of two. CCD stays enabled as
defense in depth.

Contact events fire per substep. The observer still aggregates one frame per
fixed step, but `maximumImpulse` is the largest single-substep impulse;
`totalImpulse` remains the step total.

## Accepted Invariants

- Ordinary collisions are solver-driven; gameplay does not teleport, upright,
  or replace the kart's complete velocity after an impact.
- Straight impacts substantially remove surface-normal speed without excessive
  rebound.
- Shallow impacts retain useful tangential motion and do not stick to the wall.
- Off-center contacts create bounded angular response through their real lever
  arm.
- A glancing outside-corner impact retains useful exit speed, while a kart
  driven into the inside corner contacts both faces and can reverse out under
  ordinary input without remaining snagged.
- Suspension arms, shocks, hubs, and decorative parts never collide.
- Ramps support finite wheel volume, coherent launches, partial support,
  springy landings, and visible chassis clearance without false lip colliders.
- Wheel support cannot hit obstacles, the kart, or helpers; the kart itself
  continues to collide with both support surfaces and solid obstacles.
- Contact vectors and results never escape PlayCanvas's pooled callback data.
- CCD configuration survives body recreation, and the kart stays within 0.05 m
  of the thin-barrier safety fixture's near face at 20.4 m/s from any start
  offset on grass or standard ground, without being pushed into the floor.
- Physics substep counts are powers of two (see the Ammo tool node).
- Runtime teardown removes contact listeners and destroys all owned Ammo sweep
  allocations exactly once.

## Verification

- `tests/kart-collision-observer.spec.ts` verifies normal orientation, point
  approach-speed reconstruction, copied pooled data, aggregation, and teardown.
- `tests/ammo-rigid-body.spec.ts` verifies CCD validation, setters, activation,
  and retained configuration.
- `tests/kart-collision-model.spec.ts` verifies default and scaled
  geometry-derived CCD, shared-policy ownership, and substep selection.
- `tests/playcanvas-runtime.spec.ts` verifies pre/update/post/render ordering,
  fixed-step callback lifecycle, and exact per-step substep application.
- `tests/home.spec.ts` keeps browser coverage for course collision setup and
  the thin-barrier case on both surfaces at five start offsets. Wall-impact
  response (straight, glancing, off-center, and corner escape) no longer has automated coverage after the
  2026-10-17 trim and relies on manual driving QA.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and the Playwright desktop and mobile projects provide repository,
  production, and supported-viewport regression coverage.

## Known Limits And Deferred Work

- The rough course uses primitives rather than final authored track meshes.
- The diagnostic adapter summarizes controlled collision frames but there is no
  general in-game collision visualizer or player-facing telemetry UI.
- Substeps cap at 8, so point speeds above about 48 m/s exceed the 0.05 m
  per-substep bound; future materially higher speed envelopes require new
  controlled tests and retuning.
- Substeps are chosen from the player kart's motion only; kart-to-kart contact
  (Phase 8) should select from the fastest dynamic body.
- Not implemented: kart-to-kart contact policy (Phase 8), damage and
  detachable parts (Phase 6), physical wheel bodies, per-child kart materials,
  and per-surface material authoring.
- Representative mobile performance acceptance is deferred to Phase 9.
