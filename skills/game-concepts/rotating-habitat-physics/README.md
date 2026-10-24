# Rotating-Habitat Physics

**Maturity:** Validated (PR 4.3.2, 2026-10-23).

## Purpose and Scope

This node defines how bodies should move inside a spinning habitat such as
Island Three. Read it before changing gravity, Coriolis, "up", or anything
that assumes a fixed vertical: kart forces, recovery, cameras, particles, or
courses placed away from the floor. The habitat's structure and placement
conventions live in [`docs/island-three.md`](../../../docs/island-three.md).
It inherits the rigid-body standard in
[`kart-physics`](../kart-physics/README.md).

## Standard

Simulate in the habitat's rotating frame, because the course, its air, and
everything authored in it turn with the cylinder. In that frame a body of mass
`m` at position `p` with velocity `v` relative to the habitat feels, besides
contact forces:

- **centrifugal gravity** `m ω² r⊥`, pointing straight away from the axis,
  where `r⊥` is the body's perpendicular offset from the axis; and
- **Coriolis force** `−2 m ω × v`, where `ω` points along the axis by the
  right-hand rule of the spin.

Spin is constant, so there is no Euler force (`−m ω̇ × r`). Use true scale with
no exaggeration. Evaluate both terms at the body's own position and velocity,
not at a course or placement reference point.

For a spin set to give `g₀` at floor radius `R`, `ω = √(g₀ / R)` and gravity
at radius `r` is `g₀ r / R`. Island Three's radius and spin are in
[`docs/island-three.md`](../../../docs/island-three.md#structure).

## Desired Outcome

The floor feels like Earth at rest, and the spin shows itself honestly in
motion:

- weight depends on heading: heavier driving spinward, lighter anti-spinward,
  unchanged along the axis;
- flights bend: a rising body drifts spinward, a falling one anti-spinward,
  and spinward flights land sooner than anti-spinward ones;
- gravity weakens toward the axis and vanishes on it; and
- "up" points toward the axis everywhere, so a flat structure is level only
  along one line and slopes away from it.

## Core Principles

1. **One field for everything.** Physics, recovery, cameras, and ballistic
   effects all use the same gravity and Coriolis, so visuals never disagree
   with physics.
2. **Local up comes from gravity's direction,** never from a fixed world axis.
   Up excludes Coriolis: Coriolis depends on velocity, and a horizon that
   tilted with speed would be dishonest.
3. **Grip follows real load.** Coriolis changes tire load, so any policy that
   predicts grip should use the weight the tires actually carry, including
   Coriolis along up.
4. **Nothing is tuned around it.** Do not cancel, scale, or fake either term to
   protect feel; change the course or the kart instead.

## Model Notes

**Why the floor has no sideways Coriolis.** The axis lies parallel to the
floor. Horizontal motion is either along the axis (`ω × v = 0`) or around it
(spinward), and spinward motion's Coriolis points straight along up. So on
flat floor, Coriolis only changes weight, by `±2ωv` for spinward speed `v`.
Sideways forces come only from vertical motion: rising motion is pushed
spinward and falling motion anti-spinward.

**Flat ground in a curved floor.** A flat course tangent to the floor at its
origin sits slightly inside the cylinder away from that line. At a distance
`d` across the spin, gravity tilts `d / R` from the course's vertical, so the
course is a faint ridge along its axial line. Along the axis there is no tilt.

**Lift-off on flat ground.** At radius `r`, a body moving anti-spinward at
`ωr / 2` relative to a flat surface feels zero net weight, and faster it
leaves the surface. On the curved floor itself, weight falls to zero only at
exactly `ωr`, where the body is at rest in inertial space, and the body never
lifts off.

**Climbing toward the axis.** On a straight ramp that rises within the plane
containing the axis, gravity keeps the same direction and only weakens.
Anywhere else its tilt changes ever faster as the ramp nears the axis. Grip
and weight shrink together, so a slope the tires can hold at the floor
(`μ > tan θ`) stays holdable all the way up. Drive and braking authority fade with grip,
and the rising speed's Coriolis pushes the body spinward against the ramp's
side, eventually stronger than its weight.

**Terms left out**, with their size for a 2 kg, 0.4 m kart:

| Term | Size | Why it is negligible |
| --- | --- | --- |
| Frame-spin coupling on body rotation (about `ω` × yaw rate × inertia) | under 0.5% of righting and grounded-roll torques | `ω` is 0.05 rad/s against yaw rates of several rad/s |
| Gravity gradient across the body | `ω² × 0.4 m ≈ 0.001 m/s²` | the body is tiny next to `R` |
| Winds driven by the spin | none modelled | the air co-rotates; drag stays relative to the habitat |

## Magnitudes

Worked examples for Island Three. On the floor:

| Effect | Size |
| --- | --- |
| Weight at rest | exactly `g₀` |
| Weight change with spinward speed | about 1% of `g₀` per m/s (±21% at 21 m/s) |
| Flight time at 21 m/s, spinward / anti-spinward | 0.82× / 1.27× the same jump without spin |
| Spinward drift after a 3 m/s vertical launch | about 2 cm |
| Gravity loss 2 m above the floor | 0.05% |
| Ridge tilt 45 m across the spin | 0.64° (0.11 m/s² downhill) |

Toward the axis:

| Radius | Gravity | Flat-ground anti-spinward lift-off | Coriolis/gravity at 13.5 m/s |
| --- | --- | --- | --- |
| 2,000 m | 0.5 g | 49.5 m/s | 27% |
| 500 m | 0.125 g | 12.4 m/s | 109% |
| 100 m | 0.025 g | 2.5 m/s | 545% |
| 0 m (axis) | 0 | any speed | unbounded |

## Failure Modes

- **Constant gravity from the placement.** Correct only at one point; hides
  slopes, the ridge, and every near-axis effect.
- **Fixed world-up in policies or cameras.** Recovery, damping, and framing
  fight the real vertical once gravity tilts.
- **Coriolis applied only to the chassis.** Ballistic visuals then disagree
  with the kart beside them.
- **Grip policies using static weight only.** They over-request grip whenever
  Coriolis lightens the kart, most of all near the axis.

## Validation

- Field checks: `g₀` at the floor, linear falloff with radius, zero on the
  axis, direction away from the axis, and Coriolis directions (spinward down,
  anti-spinward up, axial none, rising spinward).
- A resting kart on official floor courses settles as before.
- Recovery, airborne landings, and camera framing still behave on the floor.
- A climb toward the axis shows fading weight and grip, a spinward push, and
  weightless coasting at the axis. Course placements stay clear of the axis,
  so the dev-only `?axisRamp` structure in
  [`docs/island-three.md`](../../../docs/island-three.md) rises to it from a
  floor course.

## Known Limits

- Courses stay flat. Their ridge tilt grows with distance across the spin
  (`d / R`), so a course much wider than a few hundred metres across the spin,
  or any course near the axis, has to be authored with that slope in mind.

## Tool Mappings

PlayCanvas/Ammo gravity and force timing:
[`tools/playcanvas-ammo`](../../tools/playcanvas-ammo/README.md#applying-forces).
The shipped field: [`docs/kart-system/environment.md`](../../../docs/kart-system/environment.md#rotating-habitat).

## Sources

- G. K. O'Neill, *The Colonization of Space*, Physics Today 27(9), 1974.
- R. D. Johnson and C. Holbrow (eds.),
  [*Space Settlements: A Design Study*](https://ntrs.nasa.gov/citations/19770014162),
  NASA SP-413, 1977.
- T. W. Hall,
  [*The Architecture of Artificial-Gravity Environments for Long-Duration Space Habitation*](https://deepblue.lib.umich.edu/handle/2027.42/129238),
  University of Michigan dissertation, 1994; and *Artificial Gravity and the
  Architecture of Orbital Habitats*, JBIS 52, 1999. Prograde and retrograde
  as gravitationally distinct directions; Coriolis of relative motion.
- H. Goldstein, C. Poole, and J. Safko, *Classical Mechanics*, 3rd ed.,
  §4.10: forces in a rotating frame.
