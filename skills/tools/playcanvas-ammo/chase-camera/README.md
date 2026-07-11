# PlayCanvas and Ammo Chase Camera

**Maturity:** Validated. The feature lead accepted this mapping and the
implemented PlayCanvas camera, copied collision-event input, filtered
obstruction raycast, wall/corner fixtures, explicit snap lifecycle, and
editor-transition filter repair on 2026-07-11 after the agreed automated,
browser, and hands-on gates passed.

## Purpose and Scope

This node maps the engine-independent
[`chase-camera`](../../../game-concepts/chase-camera/README.md) standard onto the
repository's pinned PlayCanvas Engine and vendored Ammo.js/Bullet runtime. Read
it before implementing playable camera state, motion sampling, collision-driven
camera impulses, obstruction correction, or camera diagnostics.

It inherits runtime, stepping, rigid-body, filtering, allocation, and teardown
rules from the parent [`PlayCanvas and Ammo`](../README.md) node and contact
observation rules from [`collisions`](../collisions/README.md). Accepted Titan
Racers source ownership belongs under
[`../../../project-systems/`](../../../project-systems/README.md) only after the
implementation has passed player-facing validation.

## Supported Baseline

- PlayCanvas Engine is pinned exactly to `2.20.6`.
- Physics uses the repository-owned Ammo build and a 60 Hz fixed simulation.
- Rendering interpolates authoritative kart snapshots at browser cadence.
- The existing collision observer exposes copied per-step contact, approach
  speed, impulse, normal, and pre/post velocity data.
- The kart controller exposes wheel-support count and vertical velocity.
- One PlayCanvas world unit is one metre.

Do not add a camera, tweening, or physics dependency for this work. A
PlayCanvas or Ammo upgrade is a separate tool change.

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
4. During high slip or spin, clamp angular heading response and reduce unstable
   prediction rather than normalizing a near-zero or rapidly changing vector.

Compute signed slip from XZ forward and XZ velocity with `atan2(crossY, dot)`
only above the accepted speed threshold. Shape and clamp it before applying a
heading bias or lateral frame offset.

Calculate desired position and aim independently, then damp each toward its
target. Keep vertical position/aim response separately tunable. Set FOV through
`CameraComponent.fov` from a smoothed, clamped planar-speed mapping. Preserve
the current desktop/narrow-mobile base settings until hands-on comparison
justifies replacements.

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

Use `app.systems.rigidbody.raycastFirst(pivot, desiredPosition, options)` for
the accepted first pass. Provide `filterCollisionMask` and a `filterCallback`
or tag filter that includes course surfaces and solid obstacles but excludes
the kart, presentation children, gizmos, and non-obstructing helpers.

When a hit is returned, use its world-space point and normal to place the
camera on the kart-facing side with a small safety margin. Clamp to a minimum
pivot distance. Correct inward quickly enough to prevent clipping and recover
outward with a slower delta-time-aware response. Aim remains derived from the
stable target rather than the hit surface.

`raycastFirst` tests a zero-width line, not the camera near plane. Validate it
against the deliberate large wall, convex corner, and concave corner from
multiple headings. If edge clipping remains visible, prefer a small set of
near-plane-offset filtered rays before expanding the direct Ammo boundary. A
convex sweep requires separate evidence, reviewed allocation ownership, and a
focused low-level adapter.

## Fixtures and Test Adapter

Add a deliberately visible large wall and corner arrangement to the rough
camera test route during implementation. Use simple static PlayCanvas shapes
with honest matching visuals and the existing course collision groups. Place
them so the player can:

- drive between kart and wall until the desired camera position is obstructed;
- clear the wall and observe outward recovery;
- approach and turn around a convex edge;
- enter and reverse from a concave corner; and
- combine obstruction with collision impact without creating an artificial
  trap in the normal loop.

Do not silently enable existing test-only collision fixtures in production.
Author camera-test geometry through the data-driven course definition, with
names and placement suitable for deliberate browser scenarios. Whether the
fixtures remain in the later authored track is a later course-design decision.

Extend the deliberate scene test adapter with copied camera diagnostics and
controlled scenario access rather than reaching into private camera fields.
Useful diagnostics include filtered planar speed and heading, signed slip,
airborne blend, impact magnitude, obstruction hit/distance, desired and actual
camera pose, FOV, and a snap counter or reason.

## Snap, Editor, and Lifecycle Mapping

Replace calls that fake a snap by passing a large delta with an explicit
`snap(snapshot)` or `reset(snapshot)` API. It must initialize all retained
camera state without interpolation. Invoke it after initial scene placement,
gameplay reset, invalid-state recovery, controlled test pose changes, and
editor camera transitions.

Editor mode continues to own its separate orbit/pan camera behavior. Returning
to gameplay snaps the chase camera to the current accepted kart pose. Pausing
does not accumulate camera smoothing time. Teardown clears impact state and
any retained references; obstruction queries allocate no persistent Ammo
objects through the public PlayCanvas API.

## Verification

The mapping is not validated until focused tests demonstrate:

1. Unit-level camera math handles zero speed, forward motion, reverse, signed
   slip, heading wraparound, impact thresholds, and delta-time-independent
   damping without NaN or unbounded state.
2. Synthetic 30, 60, and 120 Hz render schedules produce equivalent camera
   pose, look target, and FOV within agreed tolerances.
3. Camera tracking remains coherent with interpolated kart presentation while
   authoritative physics continues at fixed cadence.
4. Rest, acceleration, braking through zero, reverse, controlled slip, spin,
   and recovery keep heading and prediction bounded.
5. Low-energy wall contact produces no camera kick while controlled direct and
   off-center impacts produce one capped response per qualifying fixed step.
6. Ramp launch, apex, descent, partial support, and landing preserve the
   world-up horizon and bounded vertical framing.
7. The visible large wall forces inward correction without hiding the kart and
   outward recovery does not pop.
8. Convex and concave corner scenarios show no accepted ray edge clipping,
   stuck correction, wrong-side placement, or obstruction/collision feedback
   instability.
9. Reset, invalid recovery, test teleport, and editor exit snap every retained
   state immediately.
10. Desktop and mobile Playwright projects cover supported viewport framing;
    feature-lead desktop and narrow-mobile driving confirms comfort and route
    visibility.
11. Production builds make no new third-party request and teardown leaves no
    camera listener or retained runtime resource alive.

Run repository-wide lint, typecheck, build, and relevant Playwright projects.
Behavioral acceptance remains owned by the engine-independent camera node.

## Known Limitations and Open Questions

- Public PlayCanvas raycasts are zero-width and may miss near-plane edge
  obstruction; wall and corner QA determines whether multiple rays are enough.
- Collision events arrive from the fixed-step observer while camera updates run
  at render cadence, so each normalized impact must be consumed exactly once.
- Exact heading blend, slip shaping, impact thresholds, FOV range, damping,
  obstruction margin, and airborne transition timing require implementation
  measurements and feature-lead tuning.
- Playable touch input remains PR 4 scope; PR 2C mobile acceptance covers
  framing and controlled browser scenarios rather than touch driving.
- The camera-test wall and corner are rough-course fixtures, not final
  Agricultural Zone art or guaranteed final-track geometry.

## Sources

- [PlayCanvas cameras: entity transform and component
  behavior](https://developer.playcanvas.com/user-manual/graphics/cameras/)
- [PlayCanvas projection and field of view](https://developer.playcanvas.com/user-manual/graphics/cameras/projection/)
- [PlayCanvas rigid-body ray casting and filtering](https://api.playcanvas.com/engine/classes/RigidBodyComponentSystem.html#raycastFirst)
- [PlayCanvas ray-casting guide](https://developer.playcanvas.com/user-manual/physics/ray-casting/)
- [PlayCanvas `Vec3` API](https://api.playcanvas.com/engine/classes/Vec3.html)
- [PlayCanvas `Quat` API](https://api.playcanvas.com/engine/classes/Quat.html)
- [PlayCanvas direct Ammo boundary](https://developer.playcanvas.com/user-manual/physics/calling-ammo/)
