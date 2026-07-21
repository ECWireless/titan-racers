# Versioned Derivation Formulas

## Responsibility

Derivation converts immutable authored construction into a resolved
`KartPhysicalProfile`. It must be deterministic, versioned, testable without a
running scene, and contain no override path. Persisted resolved snapshots are
non-editable evidence, never substitute authored inputs.

`kart-derivation.ts` owns the versioned resolver and resolved-snapshot schema.
`kart-physical-profile.ts` defines the nested capability output consumed by the
current runtime. `kart-development-values.ts` remains a temporary adapter for
the pre-editor runtime, not an input to persisted derivation.

## Exact Construction-To-Output Map

The resolved kart snapshot includes mass properties, geometry, and
the ten scalar fields in the current `KartPhysicalProfile`. The following map
is exhaustive for those per-kart outputs; none may accept a stat override.

| Resolved output | Authored inputs | Deterministic mapping |
| --- | --- | --- |
| Total mass | Every primitive's dimensions and material density; every sealed component's physical mass; component transforms do not change mass | Sum all primitive and component masses. Cosmetic structure and trim still contribute mass when made from physical material; paint may use an explicitly negligible coating model. |
| Center of mass | Each item's mass, local mass center, rotation, and assembly transform | Transform every local mass center into assembly space, sum `mass × position`, and divide by total mass. |
| Inertia tensor | Each item's mass, shape/dimensions, local mass center, orientation, and assembly position | Derive local shape inertia, rotate it into assembly axes, then add the parallel-axis contribution. Preserve the full tensor when products of inertia are non-zero. |
| Collision compound and smallest relevant cross-section | Authored primitives marked `collision: "solid"`, their shapes, dimensions, axes, and transforms | Copy the validated solid primitive shapes into a compound in stable ID order. Components and non-colliding primitives add no collision. The smallest box dimension or cylinder diameter/height becomes the cross-section evidence consumed by shared CCD policy. |
| Wheel stations and roles | Suspension/wheel attachment points, mirroring, steering linkage connections, transmission outputs, and brake connections | Resolve station positions plus `steered`, `driven`, service-braked, and handbraked roles. Reject missing, duplicate, floating, or incompatible stations. |
| Wheelbase, track width, wheel radius, and wheel width | Resolved wheel centers and selected wheel/tire geometry | Measure axle-center separation and left/right station separation; take radius/width from the installed assemblies. Width is physical mass/inertia/clearance geometry even though Demo v1 does not grant a direct wider-tire grip multiplier. |
| Aerodynamic `dragArea` (`CdA`) | Assembly-space axis-aligned bounds of every primitive and component mass element | Compute the union of the bounds' frontal X/Y rectangles so overlap is not double-counted, then multiply by the shared v1 shape coefficient `0.9`. This is a bounded approximation, not a mesh airflow solver. |
| Service-brake maximum force | Sealed brake system's total service-brake torque and the installed shared wheel radius | `total service-brake torque ÷ wheel radius`. Runtime distributes the bounded total by supported-wheel load and tire contact may apply less. |
| Handbrake maximum force | Sealed brake system's total rear-handbrake torque and the installed shared wheel radius | `total handbrake torque ÷ wheel radius`. Runtime retains a fixed rear-only split; it never becomes an all-wheel service-brake alias. |
| Drivetrain maximum drive force | Battery voltage/current limits; controller current limit; motor speed constant, winding resistance, safe current, and torque constant; transmission motor-rotations-per-wheel-rotation `G` and efficiency; driven wheel radii | Derive permitted near-stall motor torque, multiply by `G` and efficiency, then divide by driven-wheel radius. This is total unconstrained capability; the current fixed-split drivetrain requests an equal share at each driven station, and runtime grip may cap each share. |
| Drivetrain no-load speed | Battery effective voltage; motor speed constant; `G`; driven wheel radii | `(motor no-load angular speed ÷ G) × driven-wheel radius`. This boundary is not an authored top-speed stat. |
| Maximum center steering angle | Steering-servo maximum travel, each solid primitive's local bounds, wheelbase, track width, and steered-wheel centers, radii, and widths | Sweep the center request in both directions through servo travel in `0.01°` increments, convert each candidate to the same Ackermann inner/outer angles used at runtime, and stop before any inside-wheel path reaches the Ackermann singularity. Test each 2D oriented wheel envelope against collision elements whose vertical bounds overlap it. Retain the shared collision-free center angle and reject construction that cannot provide at least `1°`. Shared grip/rollover policy may request less at runtime. |
| Suspension spring rate | Suspension-unit spring rate and installation motion ratio `R = spring travel ÷ wheel travel` | Effective wheel rate is `spring rate × R²`. |
| Suspension damper rate | Suspension-unit damping coefficient and `R` | Effective wheel damping is `damper coefficient × R²`. |
| Suspension bump start | Unit bump-stop onset measured in spring travel and `R` | Wheel-space onset is `unit bump onset ÷ R`. |
| Suspension quadratic bump rate | Unit quadratic bump coefficient and `R` | Effective wheel-space coefficient is `unit coefficient × R³`. |

The exact runtime capability field paths are:

- `physicalProfile.aerodynamics.dragArea`;
- `physicalProfile.brakes.maximumHandbrakeForce`;
- `physicalProfile.brakes.maximumServiceBrakeForce`;
- `physicalProfile.drivetrain.maximumDriveForce`;
- `physicalProfile.drivetrain.noLoadSpeed`;
- `physicalProfile.steering.maximumCenterAngle`;
- `physicalProfile.suspension.bumpRate`;
- `physicalProfile.suspension.bumpStart`;
- `physicalProfile.suspension.damperRate`; and
- `physicalProfile.suspension.springRate`.

## Player-Facing Scores

Scores summarize derived evidence for selection UI; builders cannot edit them.
For each v1 score, normalize `(value - lower) ÷ (upper - lower)`, clamp to
`0…1`, map to `1…100`, and round to the nearest integer.

| Field | Derived value | V1 lower/upper bounds |
| --- | --- | --- |
| `playerStats.acceleration` | `maximumDriveForce ÷ totalMass` | `5…22 m/s²` |
| `playerStats.handling` | `tan(maximumCenterAngle × π ÷ 180) ÷ wheelbase` | `0.6…2.4 1/m` |
| `playerStats.speed` | drivetrain `noLoadSpeed` | `7…23 m/s` |
| `playerStats.stability` | `trackWidth ÷ (2 × max(0.01 m, centerOfMassHeightAboveContactPlane))` | `1.4…2.8` |

These ranges are versioned mappings, not desired-stat targets or overrides. A
construction outside a range clamps at the corresponding display endpoint.

The tire/surface interaction's five values are deliberately absent from the
per-kart table. Peak coefficient, peak-slip angle, sliding coefficient,
sliding-slip angle, and rolling coefficient resolve at each contact from the
installed tire construction × contacted surface material. Air density and
gravity come from the environment. Current load, motor speed/back-EMF, slip,
force utilization, and top speed are runtime results.

## Discoverable Derived Types

- `KartPhysicalProfile` groups all runtime-consumed per-kart capabilities.
- `KartAerodynamicsProfile` owns `dragArea`.
- `KartBrakesProfile` owns maximum service-brake and handbrake force.
- `KartDrivetrainProfile` owns maximum drive force and no-load speed.
- `KartSteeringProfile` owns maximum center steering angle.
- `KartSuspensionProfile` owns effective spring, damper, bump-start, and
  quadratic bump rates.

`ResolvedKartSnapshot` adds geometry, wheel stations, mass properties,
player-facing scores, registry references, and installed tire-construction
evidence around that physical profile. Contacted surface and tire/surface
interaction values remain environment/runtime inputs. Each
`ResolvedKartWheelStation` records its derived role, geometry, axle direction,
and suspension evidence.

`PersistedResolvedKartSnapshot` accepts the current snapshot or a historical
`ResolvedKartSnapshotV1`. Version-one evidence can therefore retain its
original hash for audit while new derivation emits only the current contract.

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
derivation version. Snapshot parsers dispatch by persisted snapshot and
derivation versions; the v1 parser is permanently pinned to the v1 contract,
while v2 owns the current contact-free evidence and Ackermann-aware steering
clearance rules.
