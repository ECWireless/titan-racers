# PlayCanvas and Ammo Wheel-Volume Suspension

**Maturity:** Validated. The feature lead accepted this tool mapping on
2026-07-10, and the Ammo cylinder sweep, filtered support, suspension,
presentation, teardown, regression, and hands-on gates now pass in Titan
Racers.

## Purpose and Scope

This node maps the engine-independent
[`wheel-suspension`](../../../game-concepts/kart-physics/wheel-suspension/README.md)
extension onto PlayCanvas Engine `2.20.6` and the repository's vendored
Ammo.js/Bullet build.

It inherits fixed-step ownership, direct-Ammo containment, force application,
reset, presentation interpolation, allocation, and teardown rules from the
parent [`PlayCanvas and Ammo`](../README.md) node. Read the sibling
[`collisions`](../collisions/README.md) node when changing lateral wheel
protection, ramps, obstacles, or contact behavior.

Actual shipped source ownership belongs under
[`../../../project-systems/`](../../../project-systems/README.md) only after the
implementation has been accepted.

## Selected Mapping

Keep the existing dynamic PlayCanvas compound kart body and custom per-wheel
force controller. Replace each public PlayCanvas ray support query with a
direct, narrowly wrapped Ammo `convexSweepTest` using a wheel-sized cylinder.

The vendored Ammo build exposes:

- `btCylinderShapeX` and `btCylinderShapeZ` for axle-aligned wheel volumes;
- `btTransform` for the maximum-compression and maximum-droop poses;
- `ClosestConvexResultCallback` for the closest hit, normal, point, entity, and
  hit fraction; and
- `btCollisionWorld.convexSweepTest` through the PlayCanvas dynamics world.

Use an X-axis cylinder for the current kart because its wheel axles run along
the chassis-local X direction. Compose each from/to transform from the
authoritative chassis pose, wheel attachment, suspension direction, and steer
angle. Keep wheel rolling presentation out of the support volume orientation;
a cylinder is rotationally symmetric around its axle.

## Direct Ammo Boundary

Create a focused wheel-sweep adapter beside the existing rigid-body Ammo
adapter. It should accept ordinary TypeScript or PlayCanvas value data and
return copied ordinary data. No Ammo object may escape into the kart controller,
React state, telemetry, or tests.

Own and reuse, rather than allocate per fixed step:

- one cylinder collision shape per distinct wheel dimension, or one shared
  immutable shape when all four wheels match;
- from/to transforms and their origin/rotation values;
- sweep start/end vectors; and
- one callback per sequential query or a safely reset reusable callback whose
  complete hit state is proven to reset correctly.

Destroy every owned shape, transform, vector, quaternion, and callback exactly
once during controller/runtime teardown. If callback reuse cannot be proven
safe against the vendored binding, use a small fixed pool created at
initialization rather than allocating four callbacks on every 60 Hz step.

Copy hit fraction, point, normal, and entity identity before the next sweep.
Never retain wrapped Ammo pointers from the callback.

## Filtering

PlayCanvas's public `raycastFirst` supports a semantic filter callback, but the
direct Ammo closest-convex callback filters by broad collision group and mask.
Assign explicit physics groups for at least:

- drivable support surfaces;
- solid obstacles and barriers;
- the kart; and
- triggers or non-supporting helpers where applicable.

Configure wheel sweeps to query only the drivable-support group. Configure the
kart rigid body to continue colliding with both support surfaces and solid
obstacles. Preserve existing trigger behavior.

Treat group/mask values as shared project constants rather than scattered
bitmasks. Add regression coverage proving that a wall blocks the chassis but
does not become wheel support, and that every intended ramp and road surface is
both sweep-visible and physically collidable.

## Compression and Contact Mapping

Place the from transform at the wheel-center pose for maximum suspension
compression and the to transform at maximum droop. The closest hit fraction
maps onto travel between those poses. Compute:

- current supported wheel-center position;
- suspension length and compression;
- hit point and road normal;
- contact offset from the authoritative chassis root; and
- contact-point velocity from chassis linear and angular velocity.

Use the copied hit point and normal for suspension and tire-force application
through PlayCanvas's public `RigidBodyComponent.applyForce`. Keep the existing
load budget and combined tire-force limit until measurements justify retuning.

A convex sweep may begin overlapped at maximum compression. Test and handle the
callback's initial-overlap result deliberately; do not reinterpret a zero hit
fraction without checking its point, normal, and authored pose. Keep maximum
compression outside the chassis and away from expected road penetration.

## Suspension Tuning

Retain the physical units from the parent node. For each wheel's approximate
sprung mass, calculate critical damping as `2 * sqrt(springRate * sprungMass)`
and expose damping as an intentional ratio.

The current nominal values are a baseline, not an accepted target. Tune:

- compression and droop travel;
- static compression and ride height;
- spring rate or equivalent ride frequency;
- damping ratio;
- progressive bump-stop start, stiffness, and cap; and
- optional maximum suspension expansion speed.

Run static equilibrium before ramp tuning. A lower damper can make the landing
more playful, but the accepted result still needs one primary rebound and no
more than one smaller settling motion for an ordinary jump.

## Wheel and Suspension Presentation

Extend per-wheel telemetry with the completed fixed-step hub position and
suspension state. Snapshot previous and current values alongside the existing
kart presentation snapshots. Interpolate wheel hubs and suspension endpoints
using the runtime accumulator fraction; never feed the interpolated pose back
into support or force calculation.

Keep the wheel pivot responsible for:

- interpolated suspension translation;
- accepted steer angle for front wheels; and
- visual roll around the axle from longitudinal travel.

Build A-arms and shocks as non-colliding PlayCanvas model primitives. Author
their chassis endpoints in chassis-local space and wheel endpoints relative to
the moving hub. For each frame, position a bar at the midpoint between its
endpoints, orient its long axis toward the opposite endpoint, and scale its
length to the endpoint distance. Handle zero-length or degenerate endpoints
without generating invalid transforms.

Use the actual chassis visual and authoritative root motion for landing drop.
Do not add a second visual chassis-bounce oscillator. Adjust wheel dimensions,
hub rest position, and chassis visual offset together to establish the accepted
static ride-height gap.

## Lateral Wheel Protection

Do not add wheel rigid bodies or joints. Do not move compound child colliders
through suspension travel during the initial implementation.

Represent lateral protection with fixed, smooth compound children on the kart
root, positioned at or slightly inboard of the visible wheel faces. Candidate
PlayCanvas shapes are X-axis capsules spanning front/rear wheel pairs or small
rounded proxies blended into the main collision envelope.

Evaluate the proxy as part of the sibling collision-envelope matrix. It must
limit visible wheel penetration, preserve useful off-center contact leverage,
slide along barriers, and avoid gaps or hooks between compound children.

## Lifecycle and Reset

Create the sweep adapter only after Ammo and the PlayCanvas dynamics world are
ready. Register it with the controller's fixed-step lifecycle and destroy it
before the PlayCanvas application and Ammo module are torn down.

Reset must clear compression history, compression velocity, hub interpolation
snapshots, wheel roll accumulation where appropriate, expansion limits, and
stale sweep results. Editor transitions must not query an inactive or destroyed
body. Resuming dynamic participation must rebuild a coherent first suspension
sample before applying a large damper response.

React cancellation and initialization failure must destroy partially created
sweep resources exactly once.

## Debugging and Test Access

Expose copied ordinary data through the deliberate non-production scene test
adapter:

- sweep start/end, radius, half-width, hit fraction, point, and normal;
- support entity and physics group;
- compression, velocity, spring, damper, bump, and total load;
- current and interpolated hub positions;
- A-arm endpoints and shock length; and
- chassis clearance and settling state for controlled scenarios.

Render optional development cylinders or line loops at compression, rest, and
droop rather than exposing Ammo shapes to presentation code.

## Verification

The mapping is not validated until tests demonstrate:

1. The vendored Ammo build exposes every sweep class and method used by the
   adapter in development and production builds.
2. Sweep resources allocate once or from a fixed pool, produce no per-step Ammo
   leak, and are destroyed exactly once.
3. Four wheel sweeps exclude the kart and non-supporting walls while detecting
   ground and every intended ramp.
4. Cylinder radius and half-width match visible tires within the accepted
   tolerance.
5. Flat-ground support, static load, and ride height are stable.
6. Ramp approach and crest results improve over the ray baseline without false
   support or unacceptable cost.
7. One-wheel and one-side fixtures produce distinct compression, load, hub, arm,
   shock, roll, and recovery evidence.
8. Small- and large-ramp landings meet the accepted travel, rebound, settling,
   bump-stop, and clearance behavior.
9. Presentation interpolation keeps hubs and suspension connected at 30, 60,
   and 120 Hz render cadences while physics stays at 60 Hz.
10. Reset, editor transitions, initialization cancellation, failure, and
    teardown leave no stale sweep state or Ammo allocation.
11. Lateral proxies prevent deep visible wheel penetration without unacceptable
    snagging or collision instability.
12. Desktop and supported mobile-target measurements show acceptable four-sweep
    cost.
13. The full existing kart-physics and runtime regression suite remains green.

## Known Limitations and Open Questions

- `convexSweepTest` is a direct Ammo boundary because PlayCanvas 2.20.6 exposes
  public rigid-body raycasts but no public convex sweep API.
- The exact callback reset contract must be proven before reusing callback
  instances; a fixed initialization-time pool is the safer fallback.
- The closest callback relies on collision groups and masks rather than the
  public PlayCanvas semantic filter callback.
- Cylinder sweeps cost more than rays and require representative browser and
  mobile measurement.
- Final wheel dimensions, ride height, travel, damping, bump response, and
  lateral proxy shape remain acceptance-tuning decisions.
- Suspension arms and shocks are visual and non-colliding by design.

## Sources

- [PlayCanvas physics basics](https://developer.playcanvas.com/user-manual/physics/physics-basics/)
- [PlayCanvas direct Ammo access](https://developer.playcanvas.com/user-manual/physics/calling-ammo/)
- [PlayCanvas compound collision shapes](https://developer.playcanvas.com/user-manual/physics/compound-shapes/)
- [NVIDIA PhysX Vehicles: cylinder sweeps, wheel dimensions, suspension
  travel, and actor force integration](https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/docs/Vehicles.html)
- [NVIDIA PhysX scene queries: convex sweep behavior and
  filtering](https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/SceneQueries.html)
- [Bullet collision world API](https://pybullet.org/Bullet/BulletFull/classbtCollisionWorld.html)
- [Bullet closest convex callback API](https://pybullet.org/Bullet/BulletFull/classbtCollisionWorld_1_1ClosestConvexResultCallback.html)
