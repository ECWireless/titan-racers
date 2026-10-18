# PlayCanvas and Ammo Wheel-Volume Suspension

**Maturity:** Validated (accepted 2026-07-10).

## Purpose and Scope

This node maps the engine-independent
[`wheel-suspension`](../../../game-concepts/kart-physics/wheel-suspension/README.md)
extension onto PlayCanvas `2.20.6` and the vendored Ammo build. It inherits
stepping, direct-Ammo containment, force application, reset, interpolation, and
teardown rules from the parent [`PlayCanvas and Ammo`](../README.md) node. Read
the sibling [`collisions`](../collisions/README.md) node when changing lateral
wheel protection or ramps.

## Mapping

PlayCanvas 2.20.6 exposes public raycasts but no convex sweep, so each wheel
uses a narrowly wrapped direct-Ammo `convexSweepTest` with an X-axis cylinder
(`btCylinderShapeX`, since the axles run along chassis-local X) and a
`ClosestConvexResultCallback`. From/to transforms come from the authoritative
chassis pose, wheel attachment, suspension direction, and steer angle; rolling
rotation is irrelevant because the cylinder is symmetric about its axle.

`src/game/runtime/ammo-wheel-sweep.ts` owns the shapes, transforms, vectors, and
one reused callback, allocated once and reset before every query (closest-hit
fraction to 1, hit object cleared). It returns copied plain data (fraction,
point, normal, entity) and destroys every allocation exactly once at teardown.
No Ammo pointer escapes.

## Filtering

The direct callback filters by collision group and mask rather than
PlayCanvas's semantic filter callback. Sweeps use the `wheelProbe` group and
`wheelSupport` mask from `src/game/physics/collision-groups.ts`, so they hit only
drivable surfaces; the kart body still collides with both surfaces and solid
obstacles. Keep group/mask values in that shared module, never as scattered
bitmasks. A wall must block the chassis without becoming wheel support.

## Compression and Contact

The sweep starts at the wheel-center pose for maximum compression and ends at
maximum droop; the hit fraction maps onto travel. From the copied hit, compute
supported wheel-center position, compression, contact offset from the chassis
root, and contact-point velocity, then apply suspension and tire forces through
the public `applyForce`. Finite travel bounds spring and bump force; no
separate per-wheel force cap clips them.

A sweep can begin overlapped at maximum compression. Do not reinterpret a zero
hit fraction without checking its point and normal; keep maximum compression
outside the chassis and away from expected road penetration.

## Suspension Tuning

Spring and damper rates derive from the suspension part and its mounting
leverage (`docs/kart-system/derivation-formulas.md`). The damping ratio against
critical damping, `2 * sqrt(springRate * sprungMass)`, is a useful sanity check
for readable rebound, not an authored input. Check static equilibrium before
ramps. Shipped values live in
[`project-systems/kart-physics`](../../../project-systems/kart-physics/README.md)
and `docs/kart-system/`.

## Presentation

Per-wheel telemetry carries the completed fixed-step hub position and
suspension state, snapshotted alongside kart presentation and interpolated with
the runtime accumulator fraction. The wheel pivot owns suspension translation,
front-wheel steer, and visual roll. Arms and shocks are non-colliding
primitives whose midpoint, orientation, and length are recomputed from their
endpoints each frame (handling degenerate endpoints). Landing drop comes from
the real chassis motion; there is no second bounce oscillator.

## Lateral Wheel Protection

Any lateral wheel protection must be fixed, smooth compound children on the
kart root at or just inboard of the visible wheel faces; compound colliders
never move with suspension travel, and there are no wheel bodies or joints.
Phase 3 karts currently have no dedicated wheel-guard shape: their collision
compound is only the authored parts marked solid (see
[`project-systems/collisions`](../../../project-systems/collisions/README.md)).

## Lifecycle and Reset

Create the sweep adapter only after Ammo and the dynamics world exist; destroy
it before the application and Ammo module. Reset clears compression history,
hub snapshots, wheel roll, and stale sweep results, and the first sample after a
teleport rebuilds coherent suspension state before applying damper force. Cancelled or failed
initialization destroys partial resources exactly once.

## Test Access

The non-production scene test adapter exposes copied sweep geometry and hits,
support entity, compression, per-component load, hub positions, arm endpoints,
shock length, and clearance. Debug geometry is drawn from that data, never from
Ammo shapes.

## Known Limitations

- `convexSweepTest` is a direct-Ammo dependency and must be re-verified on any
  PlayCanvas or Ammo upgrade.
- Cylinder sweeps cost more than rays; representative mobile measurement is
  still pending (Phase 9).

## Sources

- [PlayCanvas direct Ammo access](https://developer.playcanvas.com/user-manual/physics/calling-ammo/)
- [PlayCanvas compound collision shapes](https://developer.playcanvas.com/user-manual/physics/compound-shapes/)
- [NVIDIA PhysX Vehicles: cylinder sweeps and suspension travel](https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/docs/Vehicles.html)
- [Bullet collision world API](https://pybullet.org/Bullet/BulletFull/classbtCollisionWorld.html)
- [Bullet closest convex callback API](https://pybullet.org/Bullet/BulletFull/classbtCollisionWorld_1_1ClosestConvexResultCallback.html)
