# Wheel-Volume Suspension

**Maturity:** Validated (accepted 2026-07-10).

## Purpose and Scope

This node extends the parent [`kart-physics`](../README.md) standard for
finite-radius wheel support, protruding RC-style wheels, visible ride height,
suspension articulation, springy landings, and wheel-adjacent collision
protection. Read it before changing wheel support queries, wheel dimensions,
suspension travel, spring or damper behavior, wheel or suspension
presentation, chassis clearance, or collision policy around exposed wheels.

Engine mapping lives in
[`tools/playcanvas-ammo/wheel-suspension`](../../../tools/playcanvas-ammo/wheel-suspension/README.md).

## Standard

Keep one authoritative six-degree-of-freedom chassis and model each wheel as a
finite-volume suspension query that applies support and tire forces at the
wheel contact. Drive the visible hub, tire, arms, and shock from that same
suspension state.

Do not add separately simulated wheel bodies and joints to make suspension
visible. For an arcade RC target they add constraint instability, snagging,
mass-ratio sensitivity, and tuning cost without improving the driving model.

## Desired Outcome

The kart visibly sits on its wheels. Players read ride height, load, partial
support, landing severity, and recovery from wheel and suspension motion. On a
landing the tires meet the ground first, hubs move up through their travel,
arms fold, shocks compress, and the real chassis descends before rebounding and
settling: lively and toy-like, never a perpetual pogo or a canned animation.

## Core Principles

1. **One chassis remains authoritative.** Visual suspension is not a second
   simulation.
2. **Wheel volume matters.** A finite-radius query meets ramp faces and ledges
   before the wheel center crosses them.
3. **One suspension state drives everything.** Forces, telemetry, hub position,
   arm articulation, shock length, and tests share the same compression.
4. **Ride height is intentional.** Wheel radius, attachment, rest length, and
   chassis geometry create a visible static gap.
5. **Springiness is bounded.** Travel, spring, damping, bump stop, and droop
   produce a readable rebound without uncontrolled oscillation.
6. **Protruding wheels need a collision policy** that prevents deep visible
   penetration without hooks or wheel joints.
7. **Presentation follows physics.** No canned chassis bounce.
8. **Asymmetry survives.** One-wheel and one-side landings look and behave
   differently from symmetric ones.

## Recommended Model

### Finite-radius support

Sweep a wheel-shaped convex volume along each suspension's travel, from
maximum compression to maximum droop, matched closely to the visible tire. The
hit supplies the support surface, point, normal, and fraction from which wheel
travel and compression derive. Filter sweeps to surfaces allowed to support the
kart; a wall may collide with the chassis without becoming tire support.

### Ride height and proportions

Author tire radius and width, track and wheelbase, travel limits, rest
position, chassis floor, and attachment points together. At rest show a clear
but plausible chassis-to-ground gap; the chassis scrapes only on severe
compression, an obstacle strike, or a failed landing. Changing wheel radius
updates the support volume, visual, ride height, and collision envelope
together.

### Spring, damper, and bump

Tune spring rate from sprung mass and ride frequency, and damping as a ratio of
critical damping. Allow a visibly underdamped response: an ordinary landing
shows one clear compression and rebound, then at most one smaller settling
motion. Use a progressive bump stop near maximum compression; neither it nor
any expansion limit may invent support over empty space.

### Presentation

Place each visual hub along its suspension path from measured compression,
apply steer and rolling angles, and build arms and shocks from authored chassis
and hub pivots each frame. Presentation may interpolate completed fixed-step
states but never feeds back into force calculation. Arms, shocks, and hubs are
non-colliding.

### Lateral protection

The downward sweep does not model a tire striking a wall from the side. Protect
the visible tire envelope with smooth, fixed, chassis-owned collision geometry
at or just inboard of the tire faces, continuous enough to slide along barriers.
Do not move compound colliders through suspension travel.

## Observability

Per-wheel telemetry: support and surface; sweep geometry and hit; travel limits
and current hub position; compression and velocity; spring, damper, bump, and
total load; arm endpoints and shock length; and chassis clearance where
measurable.

## Failure Modes

Reject unconstrained ray points once wheel volume is required, wheel bodies
added for appearance, visual wheels fixed to the chassis, canned bounce,
mismatched visual and support dimensions, a ride height that looks grounded,
damping so high or low that motion is unreadable or unbounded, snag-prone
suspension colliders, support queries that accept walls or the kart, lateral
proxies with gaps or hooks, and symmetric animation for asymmetric landings.

## Validation

Accept with repeatable tests and hands-on QA covering: static equilibrium with
visible clearance; contact with ground, ramp faces and crests, and small ledges
without hovering or clipping; travel staying within limits; small and large
landings with bounded rebound; asymmetric landings; connected wheels, arms, and
shocks through every state; barrier strikes without deep penetration or
snagging; equivalent results across render cadences; and acceptable mobile cost.

## Non-Goals

Wheel rigid bodies or joints, deformable tires, detailed camber/toe/caster
kinematics, suspension damage, and production-quality wheel art.

## Sources

- [NVIDIA PhysX Vehicles: wheel sweeps and suspension geometry](https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/docs/Vehicles.html)
- [NVIDIA PhysX geometry queries](https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/GeometryQueries.html)
- [Unity wheel-collider tutorial](https://docs.unity3d.com/2023.2/Documentation/Manual/WheelColliderTutorial.html)
- [Unity wheel-collider suspension](https://docs.unity3d.com/2023.2/Documentation/Manual/wheel-colliders-suspension.html)
