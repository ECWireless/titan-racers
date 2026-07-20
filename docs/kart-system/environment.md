# World And Environment

## Responsibility

Environment data describes the race world rather than any kart. It includes
gravity and the registered construction/material of the surface contacted by
each wheel.

The demo uses Earth gravity at exactly `9.81 m/s²` and standard sea-level air
density at `1.225 kg/m³`. Kart documents and course documents cannot override
either value. The current source of truth is
`EARTH_WORLD_ENVIRONMENT` in `src/game/physics/world-environment.ts`.
Its public contract is `WorldEnvironment`.

## Contact Interaction

A surface-adjusted value such as current grip does not become permanent kart or
environment data. The runtime contact resolver combines the kart tire profile,
contacted surface material, and versioned interaction formula for each wheel.
The resolved coefficient is ephemeral contact state because different wheels
may touch different surfaces during the same step.

## Units

- gravity: `m/s²`;
- surface friction/grip coefficients: dimensionless ratios;
- restitution: dimensionless ratio; and
- air density: `kg/m³`.

## Versioning

Competitive runs pin an environment version. A material or gravity change that
affects outcomes requires a new competitive race ruleset. Presentation-only
weather or lighting changes do not become physics environment changes.

## Catalog

`kart-material-registry.ts` owns the versioned tire compounds, surface
materials, and tire/surface interactions. Phase 3B includes standard rubber on
the standard course surface. The five contact values are resolved evidence,
not editable kart statistics.
