# Kart Physics

**Maturity:** Candidate. The feature lead accepted this engine-independent
standard on 2026-07-10. Promote it to validated only after Titan Racers has an
accepted implementation and repeatable verification evidence.

## Purpose and Scope

This node defines the gold-standard behavior model for Titan Racers kart
physics. Read it before changing chassis dynamics, wheel support, suspension,
traction, steering, braking, reverse, airborne behavior, landing, or recovery.

It deliberately does not prescribe an engine API. Tool-specific implementation
guidance belongs under [`../../tools/`](../../tools/README.md), while the actual
shipped data flow and source ownership belong under
[`../../project-systems/`](../../project-systems/README.md).

## Standard

Build the kart as a genuine dynamic rigid body with wheel-level support and
force application, then layer a small number of explicit, bounded arcade
assists on top. Physics establishes the truth of the motion; assists make that
truth readable, responsive, and enjoyable without replacing it.

This hybrid standard rejects both extremes:

- a simulation whose realism makes the kart fragile, opaque, or unpleasant to
  tune, and
- scripted movement that overwrites momentum, orientation, contacts, or impact
  response to manufacture a driving pose.

## Desired Outcome

The kart should feel immediate and forgiving on the ground while remaining a
credible physical object. Acceleration, braking, steering, weight transfer,
sliding, ledge tipping, flight, landing, and collision response should belong
to one coherent motion model. A player should be able to anticipate what will
happen from the kart's pose, velocity, contact state, and input.

In particular, leaning over a platform edge must not remain artificially flat.
The supported wheels, projected center of mass, kart orientation, and momentum
must determine whether and how the kart rotates and falls.

## Core Principles

1. **One physical truth.** Normal driving never writes a desired world pose or
   locks the chassis upright.
2. **Support is local.** Determine support independently at the wheel/contact
   locations, never from one chassis-center grounded flag.
3. **Forces act where they arise.** Suspension and tire forces act at their
   wheel or contact positions so they can generate pitch, roll, and yaw.
4. **Grip is finite.** Longitudinal and lateral tire forces share a load- and
   surface-dependent force budget.
5. **Momentum survives state changes.** Leaving the ground, landing, and being
   hit do not silently discard linear or angular momentum.
6. **Assists are visible policy.** Every non-physical assist is named, bounded,
   independently tunable, and removable for diagnosis.
7. **Repeatability precedes tuning.** Gameplay physics advances on a fixed
   simulation step, independent of render cadence.
8. **Parameters describe intent.** Expose coherent, designer-facing controls
   with stable units and distinct responsibilities rather than piles of magic
   multipliers.

## Recommended Model

### Chassis and mass properties

Use one dynamic, six-degree-of-freedom chassis with explicit mass, center of
mass, and inertia. Derive initial inertia from a plausible chassis volume and
mass distribution, then tune it deliberately. Treat center-of-mass and inertia
changes as handling changes, not generic stability knobs.

Physical wheel bodies and drivetrain articulations are not required. The
visual wheels may follow the support and steering solution while the chassis
remains the authoritative rigid body.

### Wheel support and suspension

Evaluate four independent wheel support queries at the real wheel locations.
For each supported wheel, determine at least:

- the contact position, road plane, normal, and surface grip,
- suspension compression and compression velocity,
- spring and damper response,
- the resulting non-negative normal load, and
- point velocity at the contact, split into longitudinal and lateral axes.

The spring may push the chassis away from the surface but must not pull it
toward a missing surface. Bound suspension travel and use a progressive bump
stop or an equivalent stable limit response near maximum compression.

### Tire forces and controls

Compute acceleration, braking, reverse, and lateral correction at each
supported wheel. Scale the available result by tire load and surface grip, then
limit the combined longitudinal and lateral force so braking and turning must
share traction.

The model may be simpler than a road-car tire simulation, but grip breakaway
and recovery should be progressive. It must not provide full lateral grip at
zero load or add independent unlimited forces for every control axis.

Use separate designer-facing behavior for:

- drive response and approach to top speed,
- service braking,
- reverse engagement and reverse drive,
- steering input response and maximum steering by speed,
- lateral grip and its breakaway/recovery curve,
- rolling resistance and speed-dependent drag, and
- optional front/rear grip balance.

Exact steering geometry is secondary to coherent contact directions and
visible wheel angles. Add Ackermann-style inner/outer angle differences only
if they materially improve the result.

### Ledges and partial support

Do not collapse partial contact into a single grounded state. A wheel that has
left the platform contributes no suspension or tire force. Remaining support
forces continue at their actual locations while gravity acts through the
center of mass.

This must allow the chassis to tip when the remaining contacts can no longer
support its projected center of mass or when momentum produces sufficient
rotation. The approach direction, chassis orientation, supported-wheel pattern,
linear velocity, and angular velocity should therefore change the fall.

Never apply an upright lock while partially supported or airborne.

### Airborne motion, landing, and recovery

Remove suspension and tire forces independently as wheels lose support. Keep
gravity, linear momentum, angular momentum, aerodynamic effects if any, and
ordinary collision response active.

Landing should be absorbed and damped through suspension and rigid-body
contacts. Do not teleport the chassis to the road or snap it upright. Protect
the numerical simulation with bounded suspension travel, bump response, and
proportional substepping rather than by erasing impact velocity.

Any air-control assist must be modest, bounded, separately tunable, and unable
to erase the launch state or incoming collision impulse.

Recovery is a separate policy. Automatic recovery may run only after a
documented stuck or invalid-state threshold. A deliberate player reset may act
immediately, but its destination, orientation, and velocity-clearing behavior
must be explicit and verified.

### Fixed-step simulation

Advance gameplay physics with a fixed timestep, initially targeting 60 Hz.
Accumulate render time, execute the required fixed steps, cap catch-up work to
avoid a spiral after long frames, and interpolate presentation where necessary.

Use proportional whole-world or targeted substeps when suspension stiffness,
high speeds, contacts, or low-speed tire behavior require more resolution.
Substeps are a stability and accuracy tool, not a substitute for well-scaled
mass, inertia, force, and suspension parameters.

### Low-speed behavior

Slip ratios and lateral-slip calculations become poorly conditioned near zero
speed. Blend into an explicit low-speed settling model or bounded contact-plane
velocity constraint so the kart can stop smoothly and remain at rest.

The low-speed regime must release immediately when drive intent or an external
impact requires motion. Do not disguise the problem with large global linear or
angular damping, because that also destroys airborne and collision behavior.

### Arcade assists

First establish stable unassisted dynamics. Then introduce only the assists the
target feel needs, such as:

- speed-sensitive steering,
- input smoothing with asymmetric rise and release rates,
- traction shaping,
- anti-roll response based on left/right suspension load,
- bounded yaw stabilization tied to grounded state and driver intent, and
- modest airborne control.

Assists must not directly lock orientation, force the chassis onto a path,
overwrite collision impulses, or create support where no wheel has contact.

## Tuning and Observability

Keep tuning parameters in coherent groups with metres, kilograms, seconds,
newtons, and radians where applicable. Compute sensible starting values from
mass, gravity, geometry, and static wheel load when possible.

Development telemetry should expose:

- fixed-step count and dropped catch-up time,
- center of mass and chassis axes,
- support query and contact result per wheel,
- suspension compression, velocity, and load,
- longitudinal and lateral point velocity or slip,
- requested and clamped tire forces,
- grounded, partial-support, and airborne state, and
- linear and angular velocity.

Visual and numeric telemetry is part of the implementation standard because it
makes tuning causal and regressions diagnosable.

## Failure Modes

Reject implementations that rely on:

- a center-point grounded check,
- direct transform movement for normal driving,
- constant upright torque or orientation locking,
- applying all drive and grip forces at the chassis center,
- unlimited independent acceleration, braking, and lateral forces,
- tire grip while unsupported or at zero load,
- frame-rate-dependent forces or smoothing,
- large global damping used to conceal instability,
- landing or collision code that overwrites momentum, or
- undocumented magic parameters that affect several behaviors at once.

## Validation

An implementation is not accepted until repeatable tests and user-facing QA
cover the following behaviors:

1. Comparable outcomes at 30, 60, and 120 Hz render cadences.
2. Stable static equilibrium and predictable low-speed stopping.
3. Repeatable acceleration, braking, reverse, top-speed, and constant-radius
   steering results within agreed tolerances.
4. Progressive and recoverable grip loss.
5. Observable longitudinal and lateral weight transfer.
6. Different, credible ledge outcomes for different supported wheels, approach
   directions, chassis orientations, and momentum.
7. Natural ramp launch, airborne rotation, landing, upside-down, and reset
   behavior without upright snapping or unexplained angular damping.
8. No support over empty space, suspension explosions, or unacceptable
   tunneling in the agreed test course and speed envelope.
9. Development telemetry sufficient to explain every failed scenario above.
10. Acceptable performance on the demo's supported mobile target.

Agree numerical tolerances during tool mapping and implementation, once the
engine's stepping and query behavior have been measured. Do not weaken a
behavioral requirement merely because a chosen API makes it inconvenient.

## Non-Goals

The current kart-physics task does not require:

- physical wheel rigid bodies or suspension joints,
- a detailed engine, clutch, gearbox, or differential,
- Pacejka-level tire simulation, temperature, pressure, or wear,
- collision-response mastery beyond the contacts needed to exercise the kart,
- chase-camera mastery, or
- kart damage and joint breakage.

Those systems may build on this standard without being folded into it.

## Sources

- [NVIDIA PhysX Vehicle SDK: mechanical model, suspension, tire loads, combined
  grip, low-speed handling, and tuning](https://nvidia-omniverse.github.io/PhysX/physx/5.1.0/docs/Vehicles.html)
- [NVIDIA PhysX rigid-body dynamics: mass properties, forces, torque, gravity,
  velocity, and contacts](https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/RigidBodyDynamics.html)
- [Box2D documentation: fixed timesteps and substeps](https://box2d.org/documentation/hello.html)
- [Criterion Games, Vehicle Feel Masterclass: simulation foundations, assists,
  and camera](https://www.gdcvault.com/play/1025295/Vehicle-Feel-Masterclass-Balancing-Arcade)
- [Activision, Supercharged Vehicle Physics in Skylanders: combining physical
  and simplified systems with designer-facing parameters](https://media.gdcvault.com/gdc2016/Presentations/Donnelly_Patrick_Supercharged%20Vehicle%20Physics.pdf)

## Open Questions

- Which support-query shape and collision filters give the best stability and
  performance in the selected browser physics stack?
- Which fixed-step and substep combination meets both behavior and mobile
  performance requirements?
- How much anti-roll, yaw stabilization, and air control does the accepted
  Titan Racers feel actually need?
- Which numerical tolerances should become automated regression gates after
  the first measured implementation?
