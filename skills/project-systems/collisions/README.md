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
- `src/components/solo-time-trial-canvas.tsx` builds the authoritative compound
  kart envelope, applies derived body material and CCD values, builds visible
  wheel guards, contact observer, suspension presentation, copied debug
  summaries, and editor body-recreation path.
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
- `src/game/course/rough-course.v2.json` defines the accepted sparse play
  course: two cylinder obstacles, one super-tall ramp centered on the lower
  straight for counter-clockwise traffic, and controlled straight, thin-wall,
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

The reference kart remains one 1.875 kg miniature RC, six-degree-of-freedom
dynamic compound body. Its
accepted collision envelope contains:

- a low central chassis box;
- smooth X-axis capsule bumpers across the front and rear;
- smooth Z-axis lateral capsules protecting the protruding wheel envelope; and
- an upper structural/electronics-housing box preserving rollover and
  elevated-contact behavior.

The visible tires, hubs, A-arms, and shocks are presentation children rather
than separately simulated rigid bodies. Their vertical motion comes from the
same finite cylinder sweeps and suspension travel that apply forces to the
chassis. This avoids joint instability and exposed detail colliders while
keeping the visible and physical silhouettes coherent.

Course floors, the single ramp, and two cylinders use deliberately simple
static primitives. The ramp is one aligned box with no separate base or crest
lip. The diagnostic straight wall and 0.1 m thin wall are opt-in automated-test
geometry, so normal play contains no invisible or off-course collision traps.

The default kart construction supplies whole-body friction `0.12` and
restitution `0.04`. PlayCanvas compound children share one parent rigid-body
material, so this is an explicit current engine limitation rather than
per-primitive response. Static drivable surfaces and solid obstacles use zero
restitution, so Ammo's multiplicative combiner produces zero ordinary rebound.
Shared solver policy supplies low `0.08` angular damping for numerical
stability, while rigid-body linear damping is zero because explicit rolling
resistance and aerodynamic drag own coasting. None of these values is exposed
as a raw kart-tuning override. Grounded grip continues to come from the wheel
controller rather than chassis contact friction. No arcade collision impulse or
contact-time orientation assist is active. The sibling kart-physics system
applies a bounded pitch-only torque only after all wheels lose support; it does
not participate in collision resolution.

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

The default top speed is `17 m/s`, or about `0.142 m` of travel per 120 Hz step.
The controlled safety case runs at `20.4 m/s`, 20% above that target, against a
`0.1 m` static barrier.

The dynamic kart defensively derives its Ammo CCD configuration from the
accepted envelope's `0.32 m` smallest relevant protective cross-section:

- shared policy makes the swept-sphere radius half that cross-section,
  producing `0.16 m`; and
- shared policy activates CCD above 75% of that radius, producing a `0.12 m`
  motion threshold.

The values are applied only after the Ammo body exists, copied for telemetry,
and reapplied after the editor returns the kart from kinematic manipulation to
dynamic participation. The controlled `20.4 m/s` case remains blocked even
with CCD explicitly disabled because the kart envelope and authored barrier are
large enough for discrete detection. CCD is therefore defense in depth for this
envelope, not a demonstrated necessity or a replacement for honest colliders.
The enabled matrix also verifies no premature contact before reaching the wall
and bounded response during a fast rotational wall contact.

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
- Smooth bumper and wheel-guard capsules prevent exposed compound corners or
  decorative suspension pieces from hooking barriers.
- Ramps support finite wheel volume, coherent launches, partial support,
  springy landings, and visible chassis clearance without false lip colliders.
- Wheel support cannot hit obstacles, the kart, or helpers; the kart itself
  continues to collide with both support surfaces and solid obstacles.
- Contact vectors and results never escape PlayCanvas's pooled callback data.
- CCD configuration survives every supported dynamic-body creation path.
- The kart remains blocked by the thin-barrier safety fixture at `20.4 m/s`.
- Runtime teardown removes contact listeners and destroys all owned Ammo sweep
  allocations exactly once.

## Verification

- `tests/kart-collision-observer.spec.ts` verifies normal orientation, point
  approach-speed reconstruction, copied pooled data, aggregation, and teardown.
- `tests/ammo-rigid-body.spec.ts` verifies CCD validation, setters, activation,
  and retained configuration.
- `tests/kart-collision-model.spec.ts` verifies default and scaled
  geometry-derived CCD plus shared-policy ownership.
- `tests/playcanvas-runtime.spec.ts` verifies pre/update/post/render ordering and
  fixed-step callback lifecycle.
- `tests/home.spec.ts` verifies two registered cylinder obstacles, one ramp,
  finite wheel support, ground clearance, ramp compression, high-speed straight
  response, glancing tangential retention, bounded off-center rotation,
  convex-corner escape, concave-corner reverse escape, CCD-disabled and enabled
  `20.4 m/s` thin-barrier cases, premature-contact exclusion, and a bounded fast
  rotational wall contact. Existing ledge, tipping, airborne, landing,
  recovery, editor, tuning, and presentation scenarios guard integration.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, the complete desktop Playwright
  project, and focused mobile collision/suspension scenarios provide repository,
  production, and supported-viewport regression coverage.
- The feature lead accepted the wheel stance, corrected suspension-bar mounts,
  ride height, lighting, doubled top speed, simplified two-cylinder/one-ramp
  course, landing response, rear-balanced jump behavior, and general collision
  feel in the running development build on 2026-07-10 and 2026-07-11.

## Known Limits And Deferred Work

- The rough course uses primitives rather than final authored track meshes.
- The diagnostic adapter summarizes controlled collision frames but there is no
  general in-game collision visualizer or player-facing telemetry UI.
- CCD primarily protects fast translation; future materially higher angular or
  linear speed envelopes require new controlled tests and retuning.
- Kart-to-kart collision policy, damage, detachable parts, physical wheel
  bodies, per-child kart material response, general per-surface material
  authoring, and chase-camera impact response remain outside PR 2.2.2.
- Mobile browser physics scenarios are covered, but playable touch controls and
  representative-device performance acceptance remain later-phase work.
