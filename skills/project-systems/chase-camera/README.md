# Chase Camera System

## Purpose

This node documents the accepted Titan Racers chase-camera implementation. It
connects the engine-independent behavior in
[`game-concepts/chase-camera`](../../game-concepts/chase-camera/README.md) with
the PlayCanvas working methods in
[`tools/playcanvas-ammo/chase-camera`](../../tools/playcanvas-ammo/chase-camera/README.md).

The system owns playable chase framing, motion prediction, slip readability,
reverse stability, speed-sensitive field of view, airborne presentation,
impact feedback, obstruction correction, explicit camera snapping, and copied
test diagnostics. It does not own kart physics, collision response, input,
recovery policy, editor camera controls, or race progression.

## Runtime Ownership

- `src/game/camera/chase-camera.ts` owns camera tuning, delta-time-aware
  smoothing, planar motion framing, slip policy, speed FOV, airborne blend,
  impact decay, obstruction distance, transform application, explicit snap
  state, and diagnostics.
- `src/components/solo-time-trial-canvas.tsx` constructs the camera and filtered
  PlayCanvas obstruction query, supplies interpolated kart pose plus
  authoritative velocity/support signals, normalizes copied collision frames
  into camera impact events, invokes camera snap at discontinuities, and
  restores kart collision filters after editor body-type changes.
- `src/game/collision/kart-collision-observer.ts` remains the owner of copied
  contact point, normal, approach speed, impulse, and pre/post velocity data.
- `src/game/kart/dynamic-kart-controller.ts` remains the owner of supported
  wheel count and authoritative vertical velocity.
- `src/game/course/rough-course.v2.json` defines the visible off-loop camera
  test bay: one large wall and a shortened L-corner outside the established
  maximum-speed lane.
- `src/game/course/build-rough-course.ts` creates those fixtures as ordinary
  visible static solid obstacles with existing collision groups and materials.
- `src/game/testing/scene-test-adapter.ts` exposes copied camera diagnostics
  through the deliberate non-production browser-test boundary.

## Data and Update Flow

1. Fixed-step kart physics and collision solving remain authoritative.
2. The collision observer copies contacts and aggregates one frame after each
   physics step. The canvas promotes only qualifying solid-obstacle approach
   speeds into monotonically identified camera impact events.
3. Once per render frame, the canvas interpolates the kart presentation pose
   between completed physics snapshots.
4. The camera receives that interpolated position/rotation together with the
   latest rigid-body linear velocity, wheel-support count, and retained copied
   impact event.
5. The camera smooths velocity, derives planar speed and heading, applies the
   forward-only slip policy, calculates desired position/aim/FOV, blends
   airborne height, and consumes each impact identifier no more than once.
6. A filtered rigid-body raycast runs from a kart-side pivot toward the desired
   camera position. It acts as the kart collision group/mask and accepts only
   obstacle or drivable-surface tags, excluding the kart and helpers.
7. Obstruction correction moves inward quickly with a safety margin; clear
   space restores normal position damping. Impact offset remains small and
   decays independently.
8. The PlayCanvas camera entity receives the final position, world-up look-at,
   and smoothed FOV. No camera value feeds back into simulation or gameplay.

## Accepted Behavior and Invariants

- The camera tracks the same interpolated presentation timeline as the visible
  kart; physics, contacts, recovery, and telemetry remain authoritative.
- Look-ahead and chase heading derive from smoothed planar motion and
  presentation orientation, never steering input.
- At useful forward speed, motion direction contributes a bounded share of
  heading while orientation remains visible during controlled slip.
- At low speed or in reverse, framing is orientation-led. Reverse velocity is
  never interpreted as approximately 180 degrees of signed slip, preventing
  lateral side-to-side sign flips.
- Signed slip activates only above a reliable speed and only while velocity has
  a forward component. Its angle and lateral offset are capped.
- Desktop FOV ranges from 45 to 51 degrees; narrow-mobile FOV ranges from 58 to
  63 degrees. Look-ahead grows conservatively within the same speed envelope.
- Position, look target, velocity, FOV, airborne blend, impact, and obstruction
  use separate delta-time-aware response rates. Render deltas are capped at
  0.1 seconds before camera integration.
- Airborne behavior uses zero wheel support, adds bounded vertical lag, and
  always aims with world up rather than copying chassis pitch or roll.
- Only contacts above the accepted approach-speed threshold create camera
  feedback. Multiple fixed steps retain the strongest pending event until the
  next render consumes it; one event produces at most one capped directional
  offset, and sustained low-energy contact does not continuously shake the
  camera.
- Obstruction queries use the project kart group and mask. The corrected camera
  distance never extends beyond a close hit, and inward correction is faster
  than ordinary/outward position damping.
- Initial readiness, gameplay reset, invalid recovery, debug teleport, and
  editor exit snap every retained camera signal immediately.
- PlayCanvas body-type changes reset rigid-body collision filters. Both editor
  transitions therefore explicitly restore `PHYSICS_GROUP.kart` and
  `PHYSICS_MASK.kart`; an elevated rotated kart released from the editor must
  retain physical floor contact.
- Camera diagnostics are ordinary copied data and cannot mutate the camera,
  kart, PlayCanvas entities, or Ammo objects.

## Verification

Focused coverage includes:

- `tests/chase-camera.spec.ts` for reliable-speed signed slip, reverse sign
  stability, impact severity bounds, and equivalent exponential smoothing;
- `tests/course-document.spec.ts` for visible large-wall/L-corner geometry
  beyond the normal loop;
- `tests/home.spec.ts` for presentation coherence and reset snapping,
  motion-led slip and desktop/mobile FOV, wall obstruction and release, corner
  correction, bounded impact response and decay, airborne-to-landing blend,
  reverse behavior, elevated/rotated editor release, and the pre-existing
  collision, ramp, recovery, and maximum-speed integration scenarios;
- `pnpm lint`, `pnpm typecheck`, and `pnpm build`; and
- the complete desktop and mobile Playwright projects.

The accepted 2026-07-11 evidence is:

- feature-lead hands-on approval of ordinary driving, turning, slip, speed,
  wall/corner obstruction, impacts, ramp airtime/landing, reset, and the fixed
  reverse behavior;
- the canonical single-worker aggregate Playwright gate: 122 passed and eight
  intentional desktop/mobile applicability skips; and
- desktop Playwright: 63 passed and one intentional mobile-only skip; and
- mobile Playwright: 57 passed and seven intentional desktop-editor skips.

## Known Limits and Deferred Work

- Obstruction uses one zero-width ray. The accepted rough-course wall and
  corner cases show no blocking clipping, but future authored narrow geometry
  may justify near-plane-offset rays or a separately reviewed convex sweep.
- The large wall and short L-corner are rough test-bay fixtures rather than
  final Agricultural Zone art or guaranteed final-track geometry.
- Camera tuning is one kart/profile baseline. Per-kart or per-track authored
  camera profiles remain unneeded until later roster and track work proves a
  real requirement.
- Touch driving is PR 4 scope. Current mobile acceptance covers viewport
  framing and controlled browser scenarios.
- Player camera orbit, look-back, replay, ghost, spectator, multiplayer, and
  split-screen cameras remain later scope.
