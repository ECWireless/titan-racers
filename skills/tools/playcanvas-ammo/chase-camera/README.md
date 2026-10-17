# PlayCanvas and Ammo Chase Camera

**Maturity:** Validated (accepted 2026-07-11).

## Purpose and Scope

This node maps the engine-independent
[`chase-camera`](../../../game-concepts/chase-camera/README.md) standard onto the
repository's pinned PlayCanvas Engine and vendored Ammo.js/Bullet runtime. Read
it before changing playable camera state, motion sampling, collision-driven
camera impulses, obstruction correction, or camera diagnostics.

It inherits runtime, stepping, rigid-body, filtering, allocation, and teardown
rules from the parent [`PlayCanvas and Ammo`](../README.md) node and contact
observation rules from [`collisions`](../collisions/README.md). The shipped
system lives in
[`project-systems/chase-camera`](../../../project-systems/chase-camera/README.md).

## Camera State Boundary

Keep camera behavior in a focused class rather than expanding the React canvas
component with tuning equations. Pass a plain snapshot into one render-cadence
update method. The snapshot should contain only copied or stable values needed
by the camera:

- interpolated presentation position and rotation;
- authoritative linear velocity;
- supported-wheel count and vertical velocity;
- the latest qualifying copied collision frame or normalized impact event; and
- render-frame elapsed seconds.

The camera may set its PlayCanvas entity position/orientation and camera FOV.
It must not write the kart entity, rigid body, controller, collision observer,
fixed-step clock, or gameplay state.

Keep designer-facing tuning in typed ordinary TypeScript data with units and
behavioral names. Avoid mutable PlayCanvas vectors in public state or telemetry.

## Update Order and Presentation

Continue setting the kart visual from fixed-step presentation interpolation
before updating the chase camera. Use the interpolated visual pose for camera
anchor and orientation so camera and kart occupy the same rendered timeline.
Use authoritative rigid-body linear velocity, wheel support, and copied
collision observations only as motion signals; do not interpolate them back
into gameplay.

Run smoothing at render cadence with `frameSeconds`. Use exponential response
or another delta-time-aware damped model. Clamp or sanitize large render deltas
after pause, visibility change, or test stepping so one late frame cannot jump
the camera. The runtime's fixed-step accumulator does not make presentation
smoothing frame-rate independent automatically.

Avoid per-frame vector allocation in the main update path. Retain scratch
`pc.Vec3` and `pc.Quat` values as class-owned objects and copy inputs before
mutation because PlayCanvas vector operations are commonly in-place.

## Motion-Led Heading and Framing

Derive world-space kart forward from the interpolated presentation rotation.
Project both forward and authoritative linear velocity onto XZ. Preserve the
last valid planar heading only inside the camera object.

Implement explicit regimes:

1. At rest or unreliable planar speed, follow presentation forward.
2. During forward travel, blend a filtered motion heading with presentation
   forward using a speed-shaped bounded weight.
3. During braking through zero and reverse, retain a coherent orientation-led
   shot rather than treating the negative velocity vector as a request for an
   immediate orbit.
4. During unobstructed reverse travel, correct unsafe longitudinal smoothing
   lag so the kart cannot cross behind the camera. Preserve obstruction
   correction as the authority when geometry genuinely limits chase distance.
5. During high slip or spin, clamp angular heading response and reduce unstable
   prediction rather than normalizing a near-zero or rapidly changing vector.

Compute signed slip from XZ forward and XZ velocity with `atan2(crossY, dot)`
only above the accepted speed threshold. Shape and clamp it before applying a
heading bias or lateral frame offset.

Calculate desired position and aim independently, then damp each toward its
target. Keep vertical position/aim response separately tunable. Set FOV through
`CameraComponent.fov` from a smoothed, clamped planar-speed mapping, with
separate desktop and narrow-mobile bases.

Scale spatial framing values from the reference kart length: chase distance,
height, pivot height, look-ahead distance, obstruction margins, impact offsets,
and lateral slip offsets. Keep dimensionless responses, angles, time constants,
speed thresholds, and FOV values in their native units. A kart-scale migration
must update both the ordinary and maximum look-ahead bounds; leaving either at
the old world scale can push the kart out of narrow-mobile framing.

## Airborne Mapping

Use `KartController.state.supportCount === 0` as the existing zero-support
signal and `verticalVelocity` as its vertical-motion companion. Debounce or
blend the transition inside presentation state so single render samples do not
toggle camera behavior visibly.

Build camera heading on the XZ plane and use world `pc.Vec3.UP` when deriving
the final look rotation. Do not parent the camera to the kart or copy chassis
roll/pitch. In zero support, soften vertical position response and bias aim in
the bounded planar travel direction. Restore grounded response after accepted
support transition timing; do not change the controller's airborne pitch
policy.

## Impact Mapping

Consume collision data after `KartCollisionObserver.endStep()` has copied and
aggregated the fixed-step frame. Filter it through the same solid-course entity
classification used by collision metrics. Do not trigger once per contact
point.

Normalize at most one camera impact event per fixed step using:

- maximum approach speed and/or total or maximum impulse for severity;
- the strongest solid-contact normal for direction;
- a threshold, saturation range, maximum offset/angle, decay duration, and
  retrigger cooldown; and
- an event identity or step consumption rule so one copied frame is not
  replayed on every render frame.

Prefer a deterministic damped positional or angular kick aligned with the
contact direction over random shake. No direct Ammo access is needed. Camera
response must not mutate or retain pooled PlayCanvas event objects; the
collision observer's copied ordinary data remains the boundary.

## Obstruction Queries

Use `app.systems.rigidbody.raycastFirst(pivot, desiredPosition, options)`. Provide `filterCollisionMask` and a `filterCallback`
or tag filter that includes course surfaces and solid obstacles but excludes
the kart, presentation children, gizmos, and non-obstructing helpers.

When a hit is returned, use its world-space point and normal to place the
camera on the kart-facing side with a small safety margin. Clamp to a minimum
pivot distance. Correct inward quickly enough to prevent clipping and recover
outward with a slower delta-time-aware response. Aim remains derived from the
stable target rather than the hit surface.

`raycastFirst` tests a zero-width line, not the camera near plane; it passed
the wall and corner fixtures. If future geometry shows edge clipping, prefer a small set of
near-plane-offset filtered rays before expanding the direct Ammo boundary. A
convex sweep requires separate evidence, reviewed allocation ownership, and a
focused low-level adapter.

## Fixtures and Test Adapter

The rough course carries a visible off-loop large wall and L-corner, authored
through the course document with ordinary collision groups, for obstruction,
recovery, and corner scenarios. Test-only collision fixtures are never enabled
in production.

The non-production scene test adapter exposes copied camera diagnostics
(planar speed and heading, slip, airborne blend, impact, obstruction distance,
desired and actual pose, FOV, snap count) rather than private camera fields.

## Snap and Lifecycle Mapping

Use the explicit snap API, never a large fake delta. It initializes all retained
camera state without interpolation. Invoke it after initial scene placement,
gameplay reset, invalid-state recovery, replay, and controlled test pose
changes. Pausing
does not accumulate camera smoothing time. Teardown clears impact state and
any retained references; obstruction queries allocate no persistent Ammo
objects through the public PlayCanvas API.

## Verification

`tests/chase-camera.spec.ts` covers the camera math (zero speed, reverse, slip,
heading wraparound, impact thresholds, delta-time-independent damping). Browser
coverage keeps the live wall obstruction case. Hands-on desktop and
narrow-mobile driving judges comfort and route visibility.

## Known Limitations

- Raycasts are zero-width and may miss near-plane edge obstruction in narrow
  future geometry.
- Collision frames arrive at fixed-step cadence while the camera updates at
  render cadence, so each impact event must be consumed exactly once.
- The wall and corner are rough-course fixtures, not final track geometry.

## Sources

- [PlayCanvas cameras: entity transform and component
  behavior](https://developer.playcanvas.com/user-manual/graphics/cameras/)
- [PlayCanvas projection and field of view](https://developer.playcanvas.com/user-manual/graphics/cameras/projection/)
- [PlayCanvas rigid-body ray casting and filtering](https://api.playcanvas.com/engine/classes/RigidBodyComponentSystem.html#raycastFirst)
- [PlayCanvas ray-casting guide](https://developer.playcanvas.com/user-manual/physics/ray-casting/)
- [PlayCanvas `Vec3` API](https://api.playcanvas.com/engine/classes/Vec3.html)
- [PlayCanvas `Quat` API](https://api.playcanvas.com/engine/classes/Quat.html)
- [PlayCanvas direct Ammo boundary](https://developer.playcanvas.com/user-manual/physics/calling-ammo/)
