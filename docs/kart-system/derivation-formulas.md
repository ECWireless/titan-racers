# Versioned Derivation Formulas

## Responsibility

Derivation converts immutable authored construction into a resolved
`KartPhysicalProfile`. It must be deterministic, versioned, testable without a
running scene, and contain no override path. Persisted resolved snapshots are
non-editable evidence, never substitute authored inputs.

`src/game/kart/kart-physical-profile.ts` defines the current nested output
contract. `src/game/kart/kart-development-values.ts` maps the temporary flat
diagnostic surface into that contract while Phase 3B construction inputs remain
undefined.

## Exact Construction-To-Output Map

Phase 3B's resolved kart snapshot must include mass properties, geometry, and
the ten scalar fields in the current `KartPhysicalProfile`. The following map
is exhaustive for those per-kart outputs; none may accept a stat override.

| Resolved output | Authored inputs | Deterministic mapping |
| --- | --- | --- |
| Total mass | Every primitive's dimensions and material density; every sealed component's physical mass; component transforms do not change mass | Sum all primitive and component masses. Cosmetic structure and trim still contribute mass when made from physical material; paint may use an explicitly negligible coating model. |
| Center of mass | Each item's mass, local mass center, rotation, and assembly transform | Transform every local mass center into assembly space, sum `mass × position`, and divide by total mass. |
| Inertia tensor | Each item's mass, shape/dimensions, local mass center, orientation, and assembly position | Derive local shape inertia, rotate it into assembly axes, then add the parallel-axis contribution. Preserve the full tensor when products of inertia are non-zero. |
| Collision compound and smallest relevant cross-section | Collidable primitives, protective components, attachment transforms, and collision material | Union validated physical collision shapes. Render-only details add no collision. The narrowest solver-relevant section derives CCD radius and threshold through shared ratios. |
| Wheel stations and roles | Suspension/wheel attachment points, mirroring, steering linkage connections, transmission outputs, and brake connections | Resolve station positions plus `steered`, `driven`, service-braked, and handbraked roles. Reject missing, duplicate, floating, or incompatible stations. |
| Wheelbase, track width, wheel radius, and wheel width | Resolved wheel centers and selected wheel/tire geometry | Measure axle-center separation and left/right station separation; take radius/width from the installed assemblies. Width is physical mass/inertia/clearance geometry even though Demo v1 does not grant a direct wider-tire grip multiplier. |
| Aerodynamic `dragArea` (`CdA`) | Exposed primitive silhouettes, shape coefficients, transforms, and airflow gaps | Compute projected frontal union area and the versioned effective shape coefficient. Occluded overlap is not double-counted; a gap reduces drag only when the occupancy/airflow model actually leaves it open. |
| Service-brake maximum force | Combined brake component torque capability, service-braked wheel roles, efficiencies, and wheel radii | Sum each connected wheel's permitted service-brake torque × efficiency ÷ its radius. Runtime tire contact may apply less. |
| Handbrake maximum force | Combined brake component rear-handbrake torque, handbraked rear roles, efficiencies, and wheel radii | Sum each connected rear wheel's permitted handbrake torque × efficiency ÷ its radius. It never becomes an all-wheel service-brake alias. |
| Drivetrain maximum drive force | Battery voltage/current limits; controller current limit; motor speed constant, winding resistance, safe current, and torque constant; transmission motor-rotations-per-wheel-rotation `G` and efficiency; driven wheel radii | Derive permitted near-stall motor torque, multiply by `G` and efficiency, then divide by driven-wheel radius. This is total unconstrained capability; the current fixed-split drivetrain requests an equal share at each driven station, and runtime grip may cap each share. |
| Drivetrain no-load speed | Battery effective voltage; motor speed constant; `G`; driven wheel radii | `(motor no-load angular speed ÷ G) × driven-wheel radius`. This boundary is not an authored top-speed stat. |
| Maximum center steering angle | Steering-module travel/torque, linkage geometry, steering-arm locations, wheel and chassis clearance envelopes | Solve the largest collision-free center command the linkage can physically reach. Runtime Ackermann then gives separate inner/outer wheel angles, while shared speed/grip/rollover policy may request less. |
| Suspension spring rate | Suspension-unit spring rate and installation motion ratio `R = spring travel ÷ wheel travel` | Effective wheel rate is `spring rate × R²`. |
| Suspension damper rate | Suspension-unit damping coefficient and `R` | Effective wheel damping is `damper coefficient × R²`. |
| Suspension bump start | Unit bump-stop onset measured in spring travel and `R` | Wheel-space onset is `unit bump onset ÷ R`. |
| Suspension quadratic bump rate | Unit quadratic bump coefficient and `R` | Effective wheel-space coefficient is `unit coefficient × R³`. |

The tire/surface interaction's five values are deliberately absent from the
per-kart table. Peak coefficient, peak-slip angle, sliding coefficient,
sliding-slip angle, and rolling coefficient resolve at each contact from the
installed tire construction × contacted surface material. Air density and
gravity come from the environment. Current load, motor speed/back-EMF, slip,
force utilization, and top speed are runtime results.

## Runtime Formula Families

| Runtime result | Formula or dependency | Current owner |
| --- | --- | --- |
| Aerodynamic drag | `0.5 × air density × CdA × speed²` | `kart-coasting-model.ts` |
| Rolling force | supported load × current tire/surface rolling coefficient | `kart-coasting-model.ts` |
| Cornering stiffness | current peak grip × current load ÷ peak-slip angle | `kart-tire-model.ts` |
| Grip curve | peak-to-sliding coefficient interpolation across slip angle | `kart-tire-model.ts` |
| Suspension load | spring + velocity damper + progressive bump response | `kart-suspension-model.ts` |
| Service-brake wheel request | total bounded service-brake request × current wheel load ÷ total supported load | `kart-brake-model.ts` |
| Steering command limit | lower current grip/rollover boundary × shared request ratio | `kart-steering.ts` |

Values depending on current contact, compression, velocity, or surface are
runtime-resolved results even when their formulas are versioned. For example,
current wheel load and surface-adjusted grip never belong in the persisted kart
physical profile.

## Accepted Electrical Drive Mapping

The sealed battery owns fixed effective voltage, maximum current, geometry, and
mass. The sealed receiver/speed-controller module owns supported voltage,
maximum motor current, geometry, and mass. The sealed motor owns its speed
constant, winding resistance, safe current limit, geometry, and mass. Battery
capacity, depletion, temperature, voltage sag, radio range, and radio latency
are outside Demo v1.

Let `G` mean **motor rotations per wheel rotation**. Avoid an unqualified
`gearRatio` field because the reciprocal convention is common and reverses the
meaning. A transmission owns `G`, mechanical efficiency, geometry, and mass.

- safe current ceiling = minimum of battery, controller, and motor limits;
- raw stall current = battery voltage ÷ motor winding resistance;
- permitted stall current = minimum of raw stall current and the safe ceiling;
- motor torque constant in SI units = `60 ÷ (2π × speed constant in rpm/V)`;
- motor stall torque = derived torque-per-amp × permitted stall current;
- wheel stall torque = motor stall torque × `G` × drivetrain efficiency;
- launch ground force = wheel stall torque ÷ driven-wheel radius;
- motor no-load angular speed = battery voltage × motor speed constant;
- wheel no-load angular speed = motor no-load angular speed ÷ `G`; and
- theoretical vehicle no-load speed = wheel no-load angular speed × wheel
  radius.

Actual motor current and torque are runtime values because motor speed and
back-EMF change each physics step. Actual vehicle top speed normally falls below
the theoretical no-load boundary when rolling and aerodynamic resistance
consume the remaining drive force. Tire contact caps the force delivered to the
ground without changing the motor or drivetrain's unconstrained capability.
The Demo v1 drivetrain uses a fixed equal split across all configured driven
stations. An unsupported or grip-limited wheel loses its unused share; the
solver does not transfer that share to another wheel. A future differential is
component engineering and must derive its behavior from construction.

## Units And Validation

Every formula input and output uses the repository SI unit standard. Derivation
must reject missing/incompatible construction, non-finite values, impossible
geometry, and unsupported component combinations before publication.

## Versioning

A derivation version identifies formula semantics. Changing a formula creates a
new version and new resolved snapshot. Published revisions do not silently
change meaning. Historical races retain their original snapshot/hash and
derivation version.
