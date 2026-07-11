# Wheel-Volume Suspension

**Maturity:** Validated. The feature lead accepted this engine-independent
extension on 2026-07-10, then accepted the finite wheel support, visible ride
height, articulated suspension, ramp landing, and wheel-protection behavior
after repeatable automated and hands-on verification.

## Purpose and Scope

This node extends the parent
[`kart-physics`](../README.md) standard for finite-radius wheel support,
protruding RC-style wheels, visible ride height, suspension articulation,
springy ramp landings, and wheel-adjacent collision protection.

Read it before changing wheel support queries, wheel dimensions, suspension
travel, spring or damper behavior, wheel-hub presentation, suspension arms,
shock visuals, chassis clearance, or the collision policy around exposed
wheels.

It deliberately does not prescribe an engine API. Tool-specific implementation
guidance belongs under
[`../../../tools/`](../../../tools/README.md), while actual shipped source
ownership belongs under
[`../../../project-systems/`](../../../project-systems/README.md) only after
the implementation has been accepted.

## Standard

Keep one authoritative six-degree-of-freedom chassis and model each wheel as a
finite-volume suspension query that applies support and tire forces at the
wheel contact. Drive the visible wheel hub, tire, A-arms, and shock from that
same suspension state.

Do not introduce separately simulated wheel rigid bodies and joints merely to
make suspension visible. For the current arcade RC target, they add constraint
instability, snagging surfaces, mass-ratio sensitivity, and tuning complexity
without improving the intended driving model.

## Desired Outcome

The kart should visibly sit on its wheels rather than appearing to drag its
chassis along the ground. The player should be able to read ride height,
suspension load, partial support, landing severity, and recovery directly from
the wheel and suspension motion.

On a ramp landing, the tires should meet the ground first. Wheel hubs should
move upward through their suspension travel relative to the chassis, triangular
arms should fold through their authored arcs, shocks should compress, and the
real dynamic chassis should descend toward the supported wheels before
rebounding and settling.

The effect should be lively and toy-like without becoming a perpetual pogo,
an animation disconnected from forces, or a hidden upright assist.

## Core Principles

1. **One chassis remains authoritative.** Wheel support creates forces on the
   dynamic chassis; visual suspension does not become a second simulation.
2. **Wheel volume matters.** A finite-radius wheel query should encounter ramp
   faces, ledges, and small changes before the wheel center crosses them.
3. **One suspension state drives everything.** Force calculation, support
   telemetry, wheel-hub position, arm articulation, shock length, and tests use
   the same compression and travel values.
4. **Ride height is intentional.** Wheel radius, attachment location, rest
   length, chassis geometry, and visual offsets create a visible static gap and
   credible ground clearance.
5. **Springiness is bounded.** Travel, spring rate, damper ratio, bump response,
   and droop limits create a readable rebound without uncontrolled oscillation.
6. **Protruding wheels need a collision policy.** Their visible outer envelope
   must not pass deeply through barriers, but lateral protection must not create
   hooks or destabilizing wheel joints.
7. **Presentation follows physics.** Do not add a canned chassis bounce that
   disagrees with the authoritative rigid-body pose or measured wheel loads.
8. **Asymmetry survives.** One-wheel and one-side landings produce different
   compression, roll, and recovery from symmetric landings.

## Recommended Model

### Finite-radius support

Use a cylinder-shaped or similarly wheel-shaped convex sweep along each
suspension's travel direction. Match the query radius and half-width to the
visible tire closely enough that the wheel neither hovers nor sinks
conspicuously.

The query should begin at maximum compression and end at maximum droop. It
should return at least the supporting surface, hit fraction, point, and normal.
Derive wheel-center travel and suspension compression from this geometry.

A wheel-volume sweep is a support model, not a general wheel rigid body. It
finds the road geometry plane and supplies the contact used by the parent
suspension and tire-force model. Keep unsupported, partially supported, and
airborne behavior from the parent standard.

Filter sweeps to surfaces that are allowed to support the kart. A wall may
collide with the chassis without becoming a tire-support plane. Reject the kart
itself and triggers. Do not accept an arbitrary closest hit and reinterpret it
as road support.

### Ride height and wheel proportions

Author these dimensions together:

- tire radius and width;
- axle track and wheelbase;
- maximum compression and droop positions;
- static rest position and available travel in each direction;
- chassis visual floor and physical lower envelope; and
- suspension attachment points.

At static equilibrium, show an unmistakable but plausible gap between the
chassis floor and the road. Wheels may protrude laterally to create the desired
RC stance. The chassis should scrape only during deliberately severe
compression, an obstacle strike, or a failed landing.

Increasing wheel radius is valid when it improves obstacle reading and stance,
but it must update the support volume, visible tire, ride height, inertia
assumptions where relevant, and collision envelope together.

### Spring, damper, and bump response

Use the parent node's per-wheel spring and damper force model. Tune spring rate
from sprung mass and desired ride frequency, and tune damping as a ratio of
critical damping rather than as an isolated magic number.

For the playful RC target, allow a visibly underdamped response while retaining
control. An ordinary landing should show one clear compression and rebound,
then at most one smaller settling motion. Larger jumps may use more travel and
settling time, but must not bottom violently, explode numerically, or continue
oscillating without meaningful energy loss.

Use a progressive bump stop or equivalent bounded force near maximum
compression. Limit suspension expansion velocity if necessary to keep wheels
from snapping instantly to maximum droop after leaving a ramp. Neither policy
may invent support over empty space.

### Wheel and suspension presentation

Place each visual wheel hub along the authored suspension path using the
measured compression state. Apply the accepted steer angle around the local
steering axis and visual rolling angle around the axle. Presentation smoothing
may interpolate between completed fixed-step suspension states but must not feed
back into force calculation.

A triangular A-arm or double-wishbone visual is appropriate for the exposed RC
style. Build it from authored chassis pivots and wheel-hub pivots. At minimum,
show a lower A-arm and a shock/spring; add an upper arm only when it materially
improves clarity. Update bar position, orientation, and length from its endpoint
geometry rather than playing a canned animation.

Suspension arms, shocks, hubs, and decorative springs are non-colliding
presentation for this model. Their narrow geometry would create snagging and
unstable contacts without adding useful gameplay.

### Lateral protection for exposed wheels

The downward wheel sweep does not model a tire striking a vertical wall from
the side. Protect the visible outer tire envelope with smooth, chassis-owned
collision geometry positioned at or just inboard of the tire faces. Rounded
outrigger or bumper proxies are preferable to separate wheel rigid bodies.

Keep this protection continuous enough to slide along barriers without catching
between wheel shapes. It should create impacts at plausible lateral positions
so off-center hits still produce yaw and roll. Measure the visible overlap
before contact and keep it small enough that wheels do not appear to pass
deeply through obstacles.

Do not dynamically move compound collision children through suspension travel
unless a later tool-specific investigation proves the engine updates contact
velocity, mass properties, broadphase state, and inertia coherently. A fixed,
smooth chassis proxy is the accepted initial lateral policy.

## Tuning and Observability

Expose coherent suspension telemetry per wheel:

- support and supporting surface;
- sweep start, end, radius, half-width, point, normal, and hit fraction;
- maximum compression, rest position, droop, and current hub position;
- compression and compression velocity;
- spring, damper, bump-stop, and total normal load;
- whether expansion limiting is active;
- visual hub position, arm endpoints, and shock length; and
- remaining chassis-to-ground clearance where measurable.

Useful designer-facing controls include wheel radius and width, static ride
height, compression travel, droop travel, ride frequency or spring rate,
damping ratio, progressive bump range and strength, and suspension expansion
speed.

Debug rendering should show each swept wheel volume at compression and droop,
the resulting support plane, current hub position, force vector, and attachment
points.

## Failure Modes

Reject implementations that rely on:

- four unconstrained ray points after finite wheel volume becomes required;
- separately simulated wheel bodies added only for appearance;
- visual wheels fixed rigidly to the chassis despite changing compression;
- a canned chassis bounce unrelated to support forces;
- wheel visuals and support volumes with materially different radii or widths;
- static ride height that makes the chassis appear grounded;
- high damping that removes all readable suspension motion;
- low damping without bounded travel or bump response;
- suspension arms or shocks added as snag-prone collision geometry;
- wheel support queries that accept walls or the kart itself;
- wheel proxies that create gaps, hooks, or multiple conflicting lateral
  normals; or
- symmetric visual animation for an asymmetric landing.

## Validation

An implementation is not accepted until repeatable tests and hands-on QA cover:

1. Static equilibrium with a visible chassis-to-ground gap and all four wheels
   aligned with their support volumes.
2. Wheel-volume contact with flat ground, ramp approaches, ramp crests, small
   ledges, and uneven paired surfaces without hovering or obvious clipping.
3. Full compression, full droop, and rest positions that remain within authored
   travel and never create support over empty space.
4. A small-ramp landing with visible compression, one clear rebound, and no
   more than one smaller settling motion.
5. A large-ramp landing that uses more travel and bump response without
   numerical explosion, chassis tunneling, or uncontrolled pogoing.
6. One-wheel and one-side landings with corresponding asymmetric hub travel,
   arm motion, chassis roll, and recovery.
7. Wheels, A-arms, and shocks that remain connected and visually coherent
   through steering, compression, droop, flight, landing, and reset.
8. Lateral barrier and obstacle strikes that do not allow deep visible wheel
   penetration and do not create unacceptable snagging.
9. Equivalent support and landing outcomes at 30, 60, and 120 Hz render
   cadences with physics fixed at the accepted rate.
10. Acceptable cost for four finite-volume wheel queries on the supported
    mobile target.
11. Existing acceleration, braking, reverse, steering, grip, ledge, airborne,
    landing, reset, and editor-transition behavior remains accepted.

Agree exact wheel dimensions, ride height, travel, damping ratio, bump curve,
settling tolerance, and performance budget during tool mapping and
implementation after the selected engine has been measured.

## Non-Goals

This extension does not require:

- separate wheel rigid bodies, axles, joints, or a drivetrain articulation;
- deformable tires;
- detailed camber, toe, caster, or full suspension kinematics;
- suspension damage or detachable arms;
- production-quality wheel or suspension art;
- lateral tire friction from physical wheel contacts; or
- a general vehicle framework for every future kart design.

## Sources

- [NVIDIA PhysX Vehicles: wheel raycasts and cylinder sweeps, suspension
  geometry, sprung mass, forces, and wheel placement](https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/docs/Vehicles.html)
- [NVIDIA PhysX geometry queries: convex sweeps and hit
  results](https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/GeometryQueries.html)
- [Unity wheel-collider tutorial: matching wheel visuals, radius, and suspension
  travel](https://docs.unity3d.com/2023.2/Documentation/Manual/WheelColliderTutorial.html)
- [Unity wheel-collider suspension: target position, spring, and
  damper](https://docs.unity3d.com/2023.2/Documentation/Manual/wheel-colliders-suspension.html)

## Open Questions

- Which wheel radius, width, axle track, and static ride height best communicate
  the intended RC stance without destabilizing the existing kart?
- Which ride frequency, damping ratio, compression/droop split, bump curve, and
  expansion limit deliver the accepted springy landing feel?
- Does a cylinder sweep remain stable and affordable for all four wheels in the
  selected browser physics build?
- Which fixed lateral proxy shape protects the visible tire envelope while
  producing the smoothest barrier response?
- Is a lower A-arm plus shock visually sufficient, or does the crude kart
  benefit materially from an upper arm as well?
