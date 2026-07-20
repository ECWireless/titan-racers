# Builder Components And Materials

## Status

The builder-facing catalog is intentionally **future Phase 3B work**. No stable
component IDs, material IDs, or engineering bounds are defined in 3A. This
document records the catalog contract without inventing entries that could
become a second numerical source of truth. Complete assembly components do not
carry progression unlock tiers.

## Catalog Requirements

Phase 3B must ship the component-count manifest accepted in 3A:

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

Every builder-visible component and material entry must document:

- stable ID and immutable version;
- functional category and compatible attachment points;
- authored construction and materials;
- dimensions, mass inputs, and other physical attributes with units;
- deterministic derived outputs and derivation version;
- placement or instance bounds exposed to assembly; and
- benefit, construction cost, and intended assembly role.

## Source Of Truth And Completeness

Typed component and material registries will be the executable source of truth.
This catalog will be generated from or completeness-checked against those
registries. Human documentation may explain entries but may not independently
define their numbers.

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
