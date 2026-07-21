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

The transitional reference fixture preserves the rough prototype's validated
proportions at 0.25 linear scale: `0.4625 m` long and `1.875 kg`. Its upper
housing is structure/electronics bodywork, not a cockpit. PR 3.2 adds the
versioned assembly and derivation contracts while retaining this deterministic
regression example. PR 3.3 will author and publish the Balanced Kart through the
new editor before replacing the transitional runtime kart.

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

## Document Contract

`kart-assembly-document.ts` owns the portable versioned document. It contains:

- kart identity, name, practical descriptor, and visual colors;
- stable primitive and component instance IDs;
- immutable `{ id, version }` references to approved definitions;
- transforms, primitive construction, collision roles, and materials;
- structural attachments and functional port connections;
- mirroring references; and
- suspension mounting geometry where required.

The document does not contain ownership, permissions, draft revision numbers,
publication state, author identity, timestamps, derived statistics, or resolved
physics. Those server-owned facts live in persistence records.

## Validation Boundary

`kart-assembly-validation.ts` validates the whole assembly before derivation or
save. It requires exactly one battery, controller, motor, steering module,
braking system, and transmission, plus four compatible suspensions and four
compatible wheel/tire assemblies. The current solver requires one suspension
definition and one wheel/tire definition across all four stations.

Validation also enforces a connected structural tree, compatible materials,
valid mirrors, complete functional wiring, two steered front stations, two
driven and handbraked rear stations, four service-braked and suspended stations,
coherent axles, and usable suspension leverage and rest length. Failures report
stable codes and document paths.

Structural and suspension anchors must also stay within the installed
construction's world-space bounds plus the shared `0.075 m` mounting allowance.
This permits bounded brackets and suspension arms without accepting graph-only
connections at arbitrary remote points.

After semantic validation, `kart-derivation.ts` checks resolved mass and
dimensions plus wheel/chassis collision overlap. These checks depend on derived
geometry, so they do not belong to the portable document validator.

## Units

Transforms use metres and degrees. Component construction uses SI units
and explicit material/component identifiers. Bounds and allowed axes belong to
the component definition, not to arbitrary player-entered statistics.

## Versioning

Saved assembly revisions and referenced component versions are immutable. A
builder change creates a new revision. Derivation changes never rewrite stored
evidence; historical snapshot parsers remain pinned to their original version.

## Owning Contracts

- Portable document: `src/game/kart/kart-assembly-document.ts`.
- Semantic validation: `src/game/kart/kart-assembly-validation.ts`.
- Approved definitions: `src/game/kart/kart-component-registry.ts` and
  `src/game/kart/kart-material-registry.ts`.
- Transitional runtime fixture: `src/game/kart/kart-reference-construction.ts`.
- Resolved output: `src/game/kart/kart-physical-profile.ts`.
