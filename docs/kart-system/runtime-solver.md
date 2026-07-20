# Runtime Physics Solver

## Responsibility

The runtime solver consumes a resolved kart physical profile, world environment,
shared gameplay-policy requests, and previous solver state. It owns ephemeral
contacts and motion; it does not invent permanent kart statistics.

## Runtime-Only State

Examples include:

- chassis pose, linear velocity, and angular velocity;
- wheel support and contacted entity/material;
- suspension compression, separation speed, and current load;
- slip angle, resolved contact grip, and tire-force utilization;
- requested and applied longitudinal/lateral force;
- current acceleration, yaw rate, and observed turn radius; and
- collision contacts, impulses, and CCD state.

Finite wheel sweeps locate candidate support, but the Demo v1 course
primitives define their drivable top/cap direction with the entity's authored
up axis. Ammo may return an edge normal from a cylinder sweep even over a flat
box; using that edge as support would turn forward travel into vertical force.
The controller first classifies the hit point in the registered collision
primitive's local space and accepts only its top face or upward cylinder cap.
It then orients and validates the authored support axis against suspension
travel. Primitive side faces and undersides remain non-drivable.

Suspension damper velocity is the wheel contact-point velocity projected along
the suspension/body-up axis. The damper does not use the collision normal, so a
tilted edge cannot manufacture compression velocity. Drive demand is divided
equally by the number of configured driven stations before support and tire
limits; an unavailable station's fixed share is discarded rather than
redistributed.

The four-wheel service brake apportions its bounded total request by each
supported wheel's current normal load before the combined tire-force clamp.
This shared load-aware proportioning prevents an unloaded rear wheel from
receiving the same force as a loaded front wheel. The handbrake remains a
separate fixed rear-only split so it can deliberately consume rear tire budget.

These values may be exposed through telemetry but are recalculated after load,
reset, contact change, or each fixed step. They must not be copied into an
assembly as authored values.

## Source Of Truth

- `src/game/kart/dynamic-kart-controller.ts` coordinates wheel-level force
  requests and telemetry.
- Engine-independent model files under `src/game/kart/` own individual laws.
- PlayCanvas/Ammo owns rigid-body contact integration.
- `src/game/runtime/` owns fixed-step timing and scene lifecycle.

## Timing And Units

Physics advances at the repository fixed timestep, currently 120 Hz. The
miniature reference is one quarter of the former fixture's linear size, so its
Froude-scaled suspension and rotation times are about half as long; 120 Hz
preserves approximately the previous samples per physical event. Solver
quantities use SI units and radians internally. Presentation interpolates
authoritative poses and never writes interpolated state back into physics.

## Versioning

Any solver change that can alter competitive outcomes creates a new runtime
solver version and therefore a new composite competitive race ruleset. A kart
revision alone cannot describe a solver change.
