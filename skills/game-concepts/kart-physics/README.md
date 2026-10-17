# Kart Physics

**Maturity:** Validated (accepted 2026-07-10).

## Purpose and Scope

This node defines the engine-independent behavior model for Titan Racers kart
physics. Read it before changing chassis dynamics, wheel support, suspension,
traction, steering, braking, reverse, airborne behavior, landing, or recovery.

Engine mapping lives under [`../../tools/`](../../tools/README.md). The shipped
system, its numbers, and source ownership live in
[`project-systems/kart-physics`](../../project-systems/kart-physics/README.md)
and `docs/kart-system/`.

## Focused Children

- [`wheel-suspension/`](wheel-suspension/README.md): finite-radius wheel
  support, visible ride height, articulated suspension, and landing compression.

## Standard

Build the kart as a genuine dynamic rigid body with wheel-level support and
force application, then layer a small number of explicit, bounded arcade
assists on top. Physics establishes the truth of the motion; assists make that
truth readable, responsive, and enjoyable without replacing it.

Reject both extremes: a simulation whose realism makes the kart fragile or
opaque, and scripted movement that overwrites momentum, orientation, contacts,
or impact response to manufacture a driving pose.

## Desired Outcome

The kart feels immediate and forgiving on the ground while remaining a credible
physical object. Acceleration, braking, steering, weight transfer, sliding,
ledge tipping, flight, landing, and collision response belong to one coherent
motion model, so a player can anticipate what happens from the kart's pose,
velocity, contact state, and input. Leaning over a platform edge must not stay
artificially flat.

## Core Principles

1. **One physical truth.** Normal driving never writes a desired world pose or
   locks the chassis upright.
2. **Support is local.** Determine support independently at each wheel, never
   from one chassis-center grounded flag.
3. **Forces act where they arise.** Suspension and tire forces act at their
   contact positions so they generate pitch, roll, and yaw.
4. **Grip is finite.** Longitudinal and lateral tire forces share a load- and
   surface-dependent force budget.
5. **Momentum survives state changes.** Leaving the ground, landing, and being
   hit do not silently discard linear or angular momentum.
6. **Assists are visible policy.** Every non-physical assist is named, bounded,
   independently tunable, and removable for diagnosis.
7. **Repeatability precedes tuning.** Gameplay physics advances on a fixed
   simulation step, independent of render cadence.
8. **Parameters describe intent.** Coherent controls with stable units and
   distinct responsibilities, not piles of magic multipliers.
9. **Construction, not overrides.** For buildable karts, handling emerges from
   authored construction through derivation. Shared policy is identical for
   every kart; no per-kart value compensates for another.

## Recommended Model

### Chassis and mass properties

Use one dynamic six-degree-of-freedom chassis with explicit mass, center of
mass, and inertia derived from its construction. Treat center-of-mass and
inertia changes as handling changes, not stability knobs. Physical wheel bodies
and drivetrain articulations are not required; visual wheels follow the support,
steering, and suspension solution.

### Wheel support and suspension

Evaluate independent support queries at the real wheel locations. For each
supported wheel determine the contact position, normal, and surface; suspension
compression and compression velocity; spring and damper response; a
non-negative normal load; and contact-point velocity split into longitudinal
and lateral axes.

The spring may push the chassis away from a surface but never pull it toward a
missing one. Bound travel and use a progressive bump stop near maximum
compression. Do not cap calculated suspension force with an unrelated per-wheel
load limit; that deletes support during the hardest impacts.

Wheelbase and steering angle set the low-speed turning reference; track width
and center-of-mass height set lateral load transfer and rollover; the convex
hull of currently supported contacts sets the static support base. A
center-of-mass projection outside that base must be free to tip the chassis.

Wheel radius converts drivetrain torque into ground force and changes obstacle
clearance. Tire width changes mass, packaging, and collision envelope but must
not multiply Coulomb grip: at equal compound and load, available force is the
grip coefficient times normal load.

### Tire forces

Compute drive, braking, and lateral force at each supported wheel, scale the
available result by load and surface grip, then clamp the combined vector so
braking and turning share traction.

Drift is an ordinary tire state, never a toggled mode. Derive a continuous slip
angle per wheel and request lateral force from load-aware cornering stiffness
(N/rad) times slip angle, not from raw lateral speed: equal tires at equal load
and slip angle request equal force regardless of speed. Response rises to peak
grip, then falls progressively toward a lower sliding plateau, whatever caused
the slip. Near zero rolling speed, where slip angle is ill-conditioned, blend
into an explicit low-speed settling response.

Separate tire construction from the contacted environment: construction owns
the curve's shape; the tire-and-surface pair resolves peak traction, sliding
traction, and rolling resistance at each contact.

Ordinary cornering should bias toward mild, recoverable understeer derived from
physical causes. A single shared safety margin on the axle trailing the
direction of travel is acceptable policy if it swaps axles in reverse and is
identical for every kart.

Brakes and handbrake consume the same combined tire budget as every other
force. Without wheel angular velocity, brake demand cannot prove lock, so do
not shrink grip, taper brake force, shorten the force lever, or reduce rear
stiffness under braking. A handbrake request brakes the rear wheels; it never
sets a drift flag, applies a yaw impulse, or overwrites angular velocity.
Counter-steering is a transient recovery input, not a sustained command.

### Drive, braking, and resistance

- **Motor:** bounded tractive force across driven wheels, never a target
  acceleration multiplied by mass. With gear ratio `G` (motor turns per wheel
  turn), low-speed wheel force ≈ `torque * G * efficiency / wheel radius` and
  no-load road speed ≈ `no-load angular speed * wheel radius / G`. Do not grant
  heavier karts proportionally more force.
- **Reverse:** a reversible motor with the same gearing uses the same force and
  speed magnitudes with the sign changed. A combined brake/reverse input brakes
  while meaningful forward motion remains, then engages reverse inside one
  shared near-zero threshold.
- **Service brake and handbrake:** bounded total force or torque from hardware
  (`torque / wheel radius`), capped by remaining tire budget. Hardware-limited
  heavy karts slow less quickly; tire-limited braking approaches `mu * g`. The
  handbrake is an independent actuator, not a percentage of the service brake.
- **Resistance:** explicit forces, never generic rigid-body damping. Rolling
  resistance ≈ coefficient × normal load (deceleration roughly
  mass-independent). Aerodynamic drag ≈ `0.5 * air density * drag area * v²`,
  with drag area derived from bounded geometry.

### Steering

Steering authority decreases progressively with speed in both directions. Derive
the limit rather than authoring a high-speed angle: the nominal lateral
acceleration boundary is the lower of `peak grip * g` and
`g * track width / (2 * COM height)`; apply a shared margin and solve
`angle = atan(wheelbase * requested acceleration / speed²)`, plus any
documented transient-slip allowance, clamped to the mechanical lock. This limits only the requested wheel angle; tire forces and
rigid-body motion stay authoritative.

Treat the input as a bicycle-model center request and derive the steered wheels
through Ackermann geometry (inside `atan(L / (R - T/2))`, outside
`atan(L / (R + T/2))`). Wheel-angle response uses one shared normalized
duration unless a steering actuator is physically modeled. Diagnostics may show
requested geometric radius beside observed `|forward speed / yaw rate|`, but
the observed radius never feeds back into steering.

### Chassis lean

Body roll in turns comes from mass properties, contact-point forces, and
independently loaded suspension, never from a rotated presentation child,
canned roll torque, or artificial downforce.

### Ledges, airborne motion, and landing

A wheel that leaves the surface contributes no force; remaining support acts at
its real location while gravity acts through the center of mass. Never apply an
upright lock while partially supported or airborne.

In the air keep gravity, momentum, and ordinary collision response active. Ramp
attitude emerges from support timing, suspension, mass distribution, and
inertia; do not aim the body with a target-seeking pitch moment. Landing is
absorbed through suspension and contacts, never by teleporting or snapping
upright.

### Recovery

Automatic recovery runs only after a documented invalid-state threshold. A
deliberate reset may act immediately with explicit destination, orientation,
and velocity clearing.

Manual self-righting is distinct from checkpoint recovery: when an inverted kart
rests on or just above a valid surface, a deliberate request applies a short,
bounded roll-and-lift impulse in place, derived from the kart's own inertia and
mass so every assembly recovers with similar motion. It never teleports,
writes orientation, or enters a recovery lifecycle. Any input device may request
it; the fixed-step physics boundary decides validity and applies it once.

### Fixed step and low speed

Advance gameplay physics on a fixed timestep with bounded catch-up and
presentation interpolation. Substeps are a stability tool, not a substitute for
well-scaled parameters. At low speed use explicit, shared settling policy that
releases immediately for drive intent or impacts; never hide instability with
large global damping.

### Arcade assists

First establish stable unassisted dynamics, then add only assists the feel
needs (speed-sensitive steering, input smoothing, traction shaping, anti-roll,
bounded yaw stabilization, modest air control). Assists must not lock
orientation, force a path, overwrite collision impulses, or create support
without contact.

## Development Controls and Observability

Keep development values in owner-specific contracts with SI units. The
production inspector is read-only and labels each value's owner. Non-production
fixtures may mutate bounded inputs through the test adapter, but such values
never persist or become player-facing overrides.

Telemetry should expose fixed-step counts and dropped time, center of mass and
axes, per-wheel support, compression, load, slip, requested and clamped forces,
support state, and linear and angular velocity, enough to explain any failed
scenario below.

## Failure Modes

Reject implementations that rely on a center-point grounded check, direct
transform movement for driving, constant upright torque, forces applied at the
chassis center, unlimited independent force axes, grip at zero load,
frame-rate-dependent forces, large global damping, landing or collision code
that overwrites momentum, or magic parameters affecting several behaviors.

## Validation

Accept only with repeatable tests and hands-on QA covering: equivalent outcomes
at 30, 60, and 120 Hz render cadence; stable rest and low-speed stopping;
repeatable acceleration, braking, reverse, top speed, and steering; progressive,
recoverable grip loss; visible weight transfer; credible ledge outcomes that
vary with support and momentum; natural ramp flight, landing, inversion, and
reset; no support over empty space or suspension explosions; telemetry that
explains failures; and acceptable mobile performance.

## Non-Goals

Physical wheel bodies or joints, detailed drivetrain or differential models,
Pacejka-level tires, temperature or wear, and kart damage. Those may build on
this standard without being folded into it.

## Sources

- [NVIDIA PhysX Vehicle SDK](https://nvidia-omniverse.github.io/PhysX/physx/5.1.0/docs/Vehicles.html)
- [NVIDIA PhysX rigid-body dynamics](https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/RigidBodyDynamics.html)
- [Box2D: fixed timesteps and substeps](https://box2d.org/documentation/hello.html)
- [Criterion Games, Vehicle Feel Masterclass](https://www.gdcvault.com/play/1025295/Vehicle-Feel-Masterclass-Balancing-Arcade)
- [Supercharged Vehicle Physics in Skylanders](https://media.gdcvault.com/gdc2016/Presentations/Donnelly_Patrick_Supercharged%20Vehicle%20Physics.pdf)
- [Rocket League recovery onto the wheels](https://www.epicgames.com/help/c-202300000001622/c-202300000001682/rocket-league-a202300000010022)
- [MIT OCW road-vehicle traction exercise](https://ocw.mit.edu/courses/16-682-technology-in-transportation-spring-2011/a224aa6d65b2788481794038389a69bf_MIT16_682S11_soln2.pdf)
