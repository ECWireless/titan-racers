# Authored Construction

## Responsibility

Authored construction describes what a builder assembled, not how the finished
kart performs. The Phase 3 kart builder may select approved immutable component
versions and edit their allowed transforms, attachment points, mirroring, and
bounded instance configuration. It may not directly edit mass, grip, drive
force, top speed, spring rate, inertia, or other resolved statistics.

Changing a component selection can change component-owned construction and
therefore its derived mass or capability. Moving the same component preserves
its mass and internal capability while changing assembly center of mass and
rotational inertia.

## Miniature RC Scale

Titan Racers karts are unmanned miniature RC machines. There is no driver,
seat, or occupant payload. Use a roughly 1:10-competition-inspired balanced
reference of about 0.45 m overall length and 2 kg total mass when defining the
first component catalog and fixtures. Those values are design targets, not
overrides: every published kart's actual dimensions and mass derive from its
validated construction.

The current reference fixture now preserves the rough prototype's validated
proportions at 0.25 linear scale: `0.4625 m` long and `1.875 kg`. Its upper
housing is structure/electronics bodywork, not a cockpit. Phase 3B replaces the
centralized fixture with versioned builder-authored construction while keeping
this reference as a deterministic regression example.

The fixture places `105/120` of its mass in the low body and `15/120` in the
upper housing. The low body is centered; the upper housing has a modest rear
bias. The rigid-body root is the resulting assembled center of mass, so its
upright world height is derived from the chassis datum plus that center-of-mass
offset rather than copied from a visual transform.

## Pre-Authoring Official-Kart Predictions

The first catalog uses one battery and one motor. Additional component choices
exist only where the current solver represents their physical tradeoff.

| Assembly | Predicted construction | Predicted behavior |
| --- | --- | --- |
| Speed | Taller reduction such as 4:1, larger wheels, firm suspension, longer wheelbase, moderately narrower track, low-drag structure, low mass placement with modest rear bias | Highest theoretical speed, weakest unconstrained launch, calmest turn-in, and the smallest rollover margin of the three |
| Balanced | Taller reduction with smaller wheels, intermediate wheelbase and track, low centralized mass, and intermediate effective suspension leverage | Middle launch and speed with forgiving, predictable response |
| Handling | 8:1 reduction, smaller wheels, compliant long-travel suspension, shorter wheelbase, wider track, and low centralized mass | Strongest unconstrained launch, lowest theoretical speed, quickest turn-in, and greatest rollover resistance |

These are falsifiable predictions, not target-stat overrides. With similar mass
and no tire-force cap, expected acceleration ranks handling, balanced, then
speed. Controlled fixtures may reveal a derivation, construction, or solver
problem; they may not justify hand-editing the resolved results.

## Source Of Truth

The versioned kart-assembly document and approved component registry are Phase
3B deliverables and do not exist yet. Until then,
`src/game/kart/kart-reference-construction.ts` is the centralized construction
fixture and the transitional default `KartPhysicalProfile` is its capability
fixture. Neither is a builder-facing schema.

## Units

Transforms use metres and degrees. Component construction will use SI units
and explicit material/component identifiers. Bounds and allowed axes belong to
the component definition, not to arbitrary player-entered statistics.

## Versioning

Published assembly revisions and referenced component versions are immutable.
A builder change creates a new assembly revision. Derivation changes do not
mutate an existing published revision; they produce a new resolved revision or
explicit re-publication path while historical runs retain their exact inputs.

## Owning Contracts

- Future: versioned kart-assembly document and approved-component registry.
- Current fixture: `src/game/kart/kart-reference-construction.ts`.
- Resolved output: `src/game/kart/kart-physical-profile.ts`.
