# Builder Components And Materials

## Status

The PR 3.2 catalog is implemented as deeply immutable typed registries. This
document explains its shape and choices; registry code remains the only
numerical source of truth. Every entry is freely available and complete
assembly components do not carry progression unlock tiers.

## Catalog Requirements

The initial catalog contains:

- one freely available sealed battery;
- one receiver/speed-controller module;
- one motor;
- one steering module;
- one combined braking system with service-brake and rear-handbrake behavior;
- two transmissions with distinct reduction tradeoffs;
- two suspension units with distinct compliance/travel tradeoffs; and
- two wheel/tire assemblies with distinct radius, mass, and inertia tradeoffs.

Chassis, bodywork, and structural construction remain authored primitives and
materials rather than sealed functional-component categories. Every required
wheel station receives compatible suspension and wheel/tire instances. These
are miniature unmanned RC karts: there is no driver, seat, or occupant-payload
component. Every catalog entry is freely available; no complete component has
a progression tier.

Every builder-visible component entry documents:

- stable ID and immutable version;
- functional category and compatible attachment points;
- authored construction and materials;
- dimensions, mass inputs, and other physical attributes with units;
- category-specific physical capability inputs;
- placement or instance bounds exposed to assembly; and
- plain-language purpose and tradeoff.

## Initial Component Options

Exact construction, dimensions, mass, ports, bounds, and capability fields live
in the [typed component registry](../../src/game/kart/kart-component-registry.ts)
and its [generated human-readable reference](./generated-catalog.md). The
generated reference includes every nested registry field and is checked byte
for byte in tests; it is not an independently editable numerical source.

| Definition | Human-readable construction and tradeoff |
| --- | --- |
| `battery.lipo-standard@1` — Standard battery | Sealed two-cell baseline supply; shared across the first roster so gearing and construction remain legible. |
| `control.receiver-esc-standard@1` — Standard receiver and controller | Sealed radio/control module connecting battery, motor, steering, and brakes. |
| `motor.brushless-standard@1` — Standard brushless motor | Shared sealed motor; transmission, wheel size, and assembled mass determine its result. |
| `steering.servo-standard@1` — Standard steering servo | Supplies bounded travel and torque; installed wheel/chassis clearance determines final steering lock. |
| `brakes.combined-standard@1` — Standard combined brakes | One sealed system with four-wheel service braking and a separate rear handbrake. |
| `transmission.tall-4to1@1` — Tall 4:1 transmission | Favors theoretical speed over unconstrained launch force. |
| `transmission.short-8to1@1` — Short 8:1 transmission | Favors unconstrained launch force over theoretical speed. |
| `suspension.firm-short@1` — Firm short-travel suspension | Compact, firmer construction for a calmer, lower-travel assembly. |
| `suspension.compliant-long@1` — Compliant long-travel suspension | More travel and compliance at the cost of a larger installation envelope. |
| `wheel-tire.small-standard@1` — Small wheel and tire | Improves ground-force leverage and keeps rotating construction compact. |
| `wheel-tire.large-standard@1` — Large wheel and tire | Raises theoretical speed while adding radius, mass, and inertia. |

Every required category therefore has at least one component option. Choice is
concentrated where the current derivation and solver represent a meaningful
physical tradeoff.

## Materials And Contact Definitions

Exact densities and contact coefficients live in the
[typed material registry](../../src/game/kart/kart-material-registry.ts) and the
[generated human-readable reference](./generated-catalog.md).

| Definition | Human-readable role |
| --- | --- |
| `material.structural-aluminum@1` — Structural aluminum | Light, stiff chassis rails, plates, and mounts. |
| `material.steel@1` — Steel | Dense compact mounts and protective guards. |
| `material.engineering-polymer@1` — Engineering polymer | Low-mass flexible brackets and electronics trays. |
| `material.polycarbonate-shell@1` — Polycarbonate shell | Thin impact-resistant bodywork. |
| `tire-compound.standard-rubber@1` — Standard rubber | Shared sealed tire construction for the initial wheel options. |
| `surface.standard-course@1` — Standard course surface | Baseline dry Demo v1 contact surface. |

The initial interaction is
`tire-compound.standard-rubber@1 × surface.standard-course@1 / derivation 1`.
Material compatibility and shell thickness are validated from construction;
contact values are resolved evidence, not editable kart statistics.

## Source Of Truth And Completeness

`kart-component-registry.ts` and `kart-material-registry.ts` are the executable
source of truth. Component schemas require stable IDs, immutable versions,
construction evidence, dimensions, mass inputs, ports, assembly bounds,
capabilities, and a plain-language tradeoff. Material/contact schemas require
stable versioned identities or reference pairs plus their physical inputs.
Tests completeness-check registry entries and the documented derived, runtime,
environment, and presentation references. Human documentation may not
independently define registry numbers.

## Component Engineering Boundary

Required Phase 3 assembly selects and places approved components. Editing motor
internals, tire compounds, spring cartridges, or other component engineering is
outside Phase 3 and belongs to a separately planned later phase.
Community-kart authorization does not automatically authorize component
engineering.

## Progression Boundary

Progression does not unlock complete components from the Phase 3 assembly
catalog. A separately planned component-engineering phase may define tiered
internal parts. Each engineered component then derives its required tier from
the highest-tier part used in its construction. That tier is deterministic and
cannot be edited or overridden on the component or kart.
