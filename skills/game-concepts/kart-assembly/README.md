# Kart Assembly And Physical Derivation

**Maturity:** Candidate. The feature lead accepted the Phase 3B direction on
2026-07-20; implementation and hands-on validation are still in progress.

## Purpose And Scope

This node defines how predefined Titan Racers components become a portable kart
construction and deterministic physical profile. Read it before changing the
kart document, component catalog, attachment rules, derivation formulas, or
player-facing stat bars.

Component engineering, model uploads, progression, upgrades, damage, and
persisted tuning are outside this PR 3B standard.

## Standard

Builders assemble machines from a bounded, revisioned component catalog. The
portable document records component references and permitted slot adjustments;
it never stores editable mass, grip, speed, inertia, durability, or stat-bar
values.

Kart behavior follows one directional pipeline:

1. authored construction,
2. derived physical profile,
3. environment and contact interaction,
4. shared gameplay policy,
5. runtime solver, and
6. presentation.

Fix incorrect behavior at the responsible layer. Never add a per-kart stat
override to hide an incorrect component input, derivation, policy, or solver.

## Construction Rules

- Every kart has exactly one frame, body, motor, battery, wheel set,
  suspension, and bumper set.
- The frame owns compatible named slots and bounded position/rotation ranges.
- Component references include immutable catalog revisions.
- Catalog and source fixture exports are deeply frozen, and construction arrays
  are normalized into required-category order before serialization or
  derivation.
- Instance IDs and occupied slot IDs are unique.
- Wheel-set mass and visual templates target semantic frame mounts; frames are
  the sole authority for axle positions and validated wheel geometry.
- All numeric data is finite, bounded, and expressed in metres, kilograms,
  seconds, newtons, degrees, or documented dimensionless ratios.
- Persisted data remains independent of PlayCanvas entities and Ammo objects.
- Unknown fields are rejected so derived values cannot be smuggled into the
  authored contract.

## Physical Derivation

Derivation is a pure versioned function of the validated construction and exact
catalog revisions. It produces total mass, center of mass, compound inertia,
bounds, wheel geometry, suspension inputs, collision recipes, drive/brake
inputs, grip, and normalized display stats.

Compound center of mass uses mass-weighted component centers. Compound inertia
uses each component's local box inertia plus the parallel-axis contribution
from its offset to the combined center. This follows the mass-property approach
used by Bullet compound shapes while keeping engine allocations outside the
portable layer. Primary implementation references are Bullet's
[`btCompoundShape`](https://github.com/bulletphysics/bullet3/blob/master/src/BulletCollision/CollisionShapes/btCompoundShape.cpp)
and
[`btBoxShape`](https://github.com/bulletphysics/bullet3/blob/master/src/BulletCollision/CollisionShapes/btBoxShape.h).

Display stats summarize the derived profile and never feed the solver. Their
bounds and formula version are explicit and tested.

## Validation

Acceptance requires tests proving:

- strict rejection of missing, duplicate, incompatible, unknown, stale, and
  out-of-bounds authored data;
- deterministic parse and serialization without mutating input;
- exact required-category coverage and stable component references;
- expected mass, center-of-mass, inertia, wheel, suspension, and drive results;
- explainable profile changes when a permitted component placement changes;
- no authored or derived override field enters the document; and
- the Balanced Kart remains a complete source-controlled reference fixture.

## Related Guidance

- [`../kart-physics/`](../kart-physics/README.md)
- [`../kart-physics/wheel-suspension/`](../kart-physics/wheel-suspension/README.md)
- [`../collisions/`](../collisions/README.md)
- [`../../project-systems/kart-physics/`](../../project-systems/kart-physics/README.md)
