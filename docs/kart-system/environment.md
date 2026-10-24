# World And Environment

## Responsibility

Environment data describes the race world rather than any kart. It includes
gravity and the registered construction/material of the surface contacted by
each wheel.

Every course sits in Island Three, which spins for exactly `9.81 m/s²` at its
floor. Its air is about half sea-level pressure (0.2 atm oxygen, 0.3 atm
nitrogen at 20 °C), giving a density of `0.615 kg/m³`. Kart documents and
course documents cannot override either value. The source of truth is
`HABITAT_WORLD_ENVIRONMENT` in `src/game/physics/world-environment.ts`; its
public contract is `WorldEnvironment`, whose `gravity` is the floor gravity
that sets the spin.

## Rotating Habitat

Gravity is not constant. `createHabitatField` in
`src/game/physics/rotating-habitat.ts` builds the habitat's field from the
course's enclosure placement, following the
[rotating-habitat standard](../../skills/game-concepts/rotating-habitat-physics/README.md):

- centrifugal gravity `ω² r⊥` at the kart's center of mass, away from the
  axis, with `ω = √(9.81 / R)`;
- Coriolis `−2ω × v` on the kart's velocity relative to the course; and
- local up toward the axis, which the controller, rest settling, heave
  damping, manual righting, the chase camera's height and look-at, and grass
  clippings use instead of course +Y.

Each fixed step the controller points the solver's gravity at the field and
applies Coriolis as a central force. Tire load sensitivity keeps its fixed
reference load (the kart's weight at floor gravity), because it describes the
tire, not the place. The fall-reset height and the contact shadow stay in
course coordinates.

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

## Catalog And Surface Resolution

`kart-material-registry.ts` owns immutable tire compounds, surface materials,
and tire/surface interactions. Standard rubber currently pairs with standard
course, short grass, and lawn grass. Course v3 colliders carry the versioned surface identity;
visual finish and Ammo friction/restitution remain separate.

`CourseSurfaceResolver` uses authored box/cylinder collision bounds and transforms
at each accepted wheel hit. Only surfaces on the hit's supporting plane with the
same normal compete; the highest plane wins and later document order breaks
coplanar ties. This resolves layered sandbox bands (lawn base, turf verge,
asphalt, infield turf, infield lawn) without moving colliders or issuing extra
sweeps. Elevated ramps and
bridges retain their own interaction. The controller uses the resolved pair for
all tire forces and rolling resistance; its shared steering-request policy keeps
the standard-course reference.

Both grass interactions with standard rubber use peak/sliding grip 0.85/0.65
and peak/sliding slip angles 8°/24°. `surface.short-grass@1` (dry, closely
mown turf on firm soil) has rolling resistance 0.12; `surface.lawn-grass@1`
(dry, longer uncut lawn) has 0.28. Grip and slip angles are
engineering estimates awaiting physical RC measurements; they are not claimed
as measured tire data. Rolling resistance is an order-of-magnitude calibration:
[Petterson and Gooch](https://doi.org/10.1017/dsd.2020.75), Table 2, measured
short-grass ATV coefficients around 0.049–0.10. For a wheel sinking into soft
ground, the coefficient grows roughly with the square root of sinkage over
diameter, and these wheels are 12–15 cm across, about a quarter of an ATV
tire, so the same sinkage gives about twice the coefficient (roughly 0.10–0.20).
Turf's 0.12 sits in that range; lawn's 0.28 is above it, a feel calibration for
longer grass. Both remain engineering estimates for these smaller tires and
loads. Specialized RC grass
tread can produce strong traction
([Schumacher](https://www.racing-cars.com/wheels-tyres/short-course-tyre-mini-pin-blue-pr-u6768));
that supports tire/surface dependence, not the exact grip estimates here.

## Shipped Physics Identity

`CURRENT_PHYSICS_VERSION` in `src/game/physics/physics-version.ts` identifies the
complete shipped solver, environment, and gameplay-policy combination, currently
`rotating-habitat-v1` (habitat gravity, Coriolis, and Island Three air).
`ACCEPTED_PHYSICS_VERSIONS` lists every identity
telemetry still accepts, because open tabs keep reporting their build's
version until reloaded. Telemetry pins the client build's identity when a run
starts; duplicate starts and later milestones cannot change it. Existing rows
and legacy starts remain null (unversioned), retaining their deployment
attribution. There is no historical solver replay. Future ghosts and
leaderboards must partition by physics identity alongside immutable course/kart
revisions; neither system is implemented yet.
