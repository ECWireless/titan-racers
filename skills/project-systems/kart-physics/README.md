# Kart Physics System

## Purpose

This node documents the accepted Titan Racers kart-physics implementation. It
connects the engine-independent behavior in
`skills/game-concepts/kart-physics/README.md` with the PlayCanvas and Ammo
working methods in `skills/tools/playcanvas-ammo/README.md`.

The system owns deterministic simulation timing, the authoritative dynamic
chassis, wheel support and tire forces, presentation interpolation, physics
telemetry, and explicit reset behavior. Collision mastery and chase-camera
mastery remain separate systems and PR-sized units.

## Runtime Ownership

- `src/game/runtime/fixed-step-clock.ts` accumulates render time, advances the
  simulation at 60 Hz, caps catch-up work at four steps, and reports discarded
  time.
- `src/game/runtime/playcanvas-application.ts` loads the vendored Ammo build,
  disables PlayCanvas's default variable-cadence tick, owns the animation-frame
  loop, advances whole-world fixed steps, and renders once per display frame.
- `src/game/runtime/ammo-rigid-body.ts` owns direct Ammo rigid-body mass and CCD
  configuration. `src/game/runtime/ammo-wheel-sweep.ts` separately owns the
  reusable Ammo wheel-cylinder sweep allocations and returns copied hits.
- `src/game/kart/dynamic-kart-controller.ts` owns four-wheel support queries,
  suspension forces, grounded tire forces, steering, braking, reverse, rolling
  resistance, speed response, bounded zero-support pitch-stability torque, and
  physics telemetry.
- `src/game/kart/kart-tire-model.ts` owns continuous slip angle, peak-to-sliding
  grip, and hard-braking combined-slip force shaping.
- `src/game/kart/kart-tuning.ts` owns the complete authored runtime-safe tuning
  baseline, public numeric bounds, and cross-field normalization.
- `src/game/kart/kart-drift-smoke.ts` owns supported-wheel tire smoke. Measured
  rear-wheel speed and lateral slip drive drifting levels; hard service-brake
  demand plus substantial tire-force utilization permits light straight-line
  braking smoke; countdown forward-throttle intent permits a two-layer
  rear-wheel start-hold burnout. Each path has bounded gating and release
  hysteresis.
- `src/game/kart/kart-steering.ts` owns the engine-independent speed-sensitive
  maximum steering-angle curve.
- `src/game/kart/kart-righting.ts` owns the engine-independent inverted-pose
  eligibility, shortest righting axis, singularity fallback, and angled-contact
  torque scaling used by manual recovery.
- `src/components/solo-time-trial-canvas.tsx` constructs the compound chassis,
  models a 70 kg lower body plus a 50 kg rear cockpit mass, places the physics
  root at their combined center of mass, applies mass properties, connects input
  and tuning, snapshots authoritative poses, interpolates the offset
  presentation-only kart visual, drives the chase camera from that visual, and
  coordinates reset, runtime tuning, and editor transitions.
- `src/components/kart-tuning-drawer.tsx` exposes the production, non-modal,
  session-only tuning surface with exact grouped numeric controls, accessible
  contextual explanations, and a complete default reset.
- `src/game/course/build-rough-course.ts` creates static rigid bodies and marks
  surfaces that may support the kart with the `drivable-surface` tag.
- `src/game/testing/scene-test-adapter.ts` exposes deliberate non-production
  pose, pause, step, support, load, slip, force, and signed airborne-pitch
  telemetry hooks for browser verification.

## Data And Update Flow

1. The outer animation-frame loop passes elapsed render time to the fixed-step
   clock.
2. For each required 1/60-second step, driving input enters the dynamic kart
   controller before PlayCanvas advances the whole Ammo world.
3. Each wheel sweeps a finite X-axis cylinder from maximum compression toward
   maximum droop. Collision groups restrict support to drivable surfaces.
4. A supported wheel calculates compression, damper velocity, non-negative
   normal load, contact-point velocity, longitudinal force, and lateral force.
   Combined tire force is limited by load and grip. Longitudinal force remains
   at the contact offset; under hard braking, the horizontal lever and stiffness
   of existing lateral force reduce continuously while its vertical offset
   remains physical. With no lateral contact speed there is no lateral force to
   shape, so braking demand cannot create a drift or inject sideways momentum.
5. When all four wheels are unsupported, the controller derives signed pitch
   and local pitch rate, then applies a clamped critically damped torque toward
   a six-degree nose-up target. The policy changes neither linear velocity nor
   yaw/roll angular components.
6. PlayCanvas advances rigid-body motion and collision response. The resulting
   authoritative kart pose becomes the current presentation snapshot.
7. Once per display frame, the visual child interpolates between the previous
   and current snapshots. The chase camera follows this interpolated visual;
   gameplay, recovery, collision, and telemetry continue to consume the
   authoritative physics root.

## Accepted Invariants

- Gameplay physics advances at 60 Hz independently of render cadence.
- A frame stall cannot trigger an unbounded catch-up spiral.
- The kart is one dynamic six-degree-of-freedom compound rigid body with an
  explicit 120 kg mass, deliberate local inertia tensor, and combined center of
  mass about 20 cm rearward and 0.5 cm lower than the chassis visual origin.
- No ordinary driving path writes the authoritative dynamic transform.
- Each wheel independently gains and loses support; an unsupported wheel
  contributes no suspension or tire force.
- Each visible wheel hub, lower A-arm pair, and shock follows the same measured
  suspension travel that drives support force; presentation adds no canned
  chassis bounce.
- The visible chassis has intentional static ground clearance, and the smooth
  lateral wheel-guard envelope prevents deep barrier penetration without
  physical wheel bodies or joints.
- Suspension force is non-negative and bounded. Tire force scales with normal
  load and shares a combined grip limit across longitudinal and lateral demand.
- Braking stops forward motion before reverse drive engages.
- Authored forward and reverse top speeds both default to 17 m/s; brake input
  still stops forward motion before applying reverse drive.
- Shift or standard gamepad west-face input requests rear-wheel handbraking;
  drift remains a continuous tire-slip result rather than an input mode.
- Tire smoke remains presentation-only. Supported rear-wheel lateral slip
  controls ordinary and heavy drift smoke. During racing, a hard service brake
  at meaningful forward speed can add light smoke only from supported wheels
  carrying substantial tire demand, even without lateral slip. During the
  countdown, meaningful forward throttle can add a stronger two-layer plume
  only at the supported rear driven wheels while gameplay continues to hold the
  kart stationary. The countdown path temporarily raises and trails the
  existing emitter placement so stationary particles remain visible, then
  restores the ordinary tire-local placement before driving. None of these
  smoke paths modifies tire force or race timing.
- Every runtime-safe handling, steering, tire/drift, suspension, airborne, and
  smoke threshold is sourced from one normalized tuning object. Runtime-safe
  chassis damping/contact values use that same source. Drawer changes apply
  immediately, including gravity and native rigid-body properties in the
  physics world. The chase-camera speed envelope follows the larger of the
  current forward and reverse limits. Manual-righting torque, angled boost,
  lift, and eligibility threshold use the same normalized source. Tuning never
  persists beyond the race session.
- Reset All Defaults restores the complete authored tuning object. Structural
  mass properties, center of mass, inertia, wheel/suspension geometry,
  collision/CCD configuration, and particle allocation remain rebuild-time
  configuration rather than live controls.
- During the temporary handling-polish workflow, an unmodified `T` key opens or
  closes the drawer only while an active race owns keyboard input. No visible
  opener is rendered, editable fields suppress the shortcut, and closing
  returns focus to the race canvas. This intentionally leaves touch-only mobile
  sessions without tuning access.
- Opening the drawer clears retained driving input. On coarse-pointer layouts
  it temporarily removes the underlying touch-driving group so tuning fields
  and the fixed reset action cannot overlap live steering or pedals. Pause and
  finish dialogs remove the tuning surface from interaction until racing
  resumes.
- Obscure controls expose concise explanations on pointer hover, keyboard
  focus, or tap. Escape dismisses help without pausing the race, the visible
  explanation remains hoverable, and each numeric input retains an accessible
  description even while the visual tooltip is closed.
- Steering authority falls progressively from 18 degrees at rest to 6 degrees
  at the configured forward-speed limit, while the default steering response
  approaches that bounded target at 80 degrees per second. Reverse steering
  consumes the same speed-magnitude curve.
- Partial support applies forces at the remaining wheel locations and never
  invokes an upright lock.
- Airborne motion preserves gravity, linear momentum, yaw/roll angular motion,
  and ordinary rigid-body contacts. A named, bounded pitch-only torque activates
  only at zero wheel support to prevent the accepted ramp from producing a hard
  nose dive.
- Pitch observability reports active state, signed angle, local rate,
  six-degree target, and applied torque; grounded samples must report the policy
  inactive.
- Automatic below-course recovery and ordinary upright reset requests use the
  race session's accepted checkpoint recovery, clear momentum, and enter its
  recovery lifecycle.
- A manual recovery request while the kart is at least 120 degrees inverted
  and immediately above a drivable surface instead applies bounded roll and
  lift impulses at the current transform. Steeper eligible poses receive a
  continuous torque boost; no transform, velocity, camera, or race-state reset
  occurs. A 450 ms cooldown absorbs repeated eligible requests.
- Keyboard `R`, standard-controller south-face input, the touch recovery
  control, and a bounded direct touch tap on the inverted kart all request the
  same physical righting policy. A kart tap is manual-righting-only: taps on
  empty space, drags, long presses, and upright karts do not trigger checkpoint
  recovery. A non-primary touch can tap while another finger drives.
- Editor manipulation changes the kart to kinematic participation before
  transform edits and reapplies dynamic mass properties when gameplay resumes.
- Ammo objects never escape the low-level adapter, gameplay state, telemetry,
  React state, or tests.

## Verification

The accepted system is covered by:

- `tests/fixed-step-clock.spec.ts` for 30, 60, and 120 Hz equivalence, bounded
  catch-up work, and stall clamping;
- `tests/ammo-rigid-body.spec.ts` for chassis-local inertia calculation, mass
  scaling, and validated CCD configuration;
- `tests/playcanvas-runtime.spec.ts` for engine startup, default-tick
  cancellation, callback/update/render ordering, exact manual steps, listener
  cleanup, animation-frame cancellation, and idempotent teardown;
- `tests/kart-tuning.spec.ts` for complete default bounds, finite-value
  handling, clamping, and related-threshold ordering;
- `tests/kart-drift-smoke.spec.ts` for rear-slip drift levels, release
  hysteresis, straight-line braking gates, and supported rear-only countdown
  burnout intent;
- `tests/kart-righting.spec.ts` for inversion eligibility, shortest-axis
  selection, the exactly inverted fallback, and angled-contact torque scaling;
- `tests/home.spec.ts` for finite wheel support, visible clearance, springy ramp
  landing, full-speed signed airborne pitch and assist telemetry, static equilibrium, acceleration, configured top
  speed, braking, reverse, forward and reverse steering, high-speed natural and
  brake-induced drift, longitudinal and lateral load transfer, grip saturation
  and recovery, wheel-specific ledge
  support, tipping, airborne rotation, landing, invalid-state recovery,
  production tuning hotkey behavior, tooltip accessibility, and key
  completeness, live gravity and camera-envelope propagation, straight-line
  braking smoke without drift, stationary countdown burnout smoke, complete
  default reset, modal isolation, responsive containment, editor transitions,
  loading failure/cancellation, physical flat-roof and angled-roof manual
  righting, touch tap/drag/raycast discrimination, unchanged automatic and
  upright checkpoint recovery, and interpolated presentation/camera-target
  coherence;
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` for repository-wide static and
  production-build verification; and
- the desktop and mobile Playwright projects for supported-browser runtime,
  viewport, and synthetic physics regression coverage.

User-facing acceptance additionally requires driving the development build and
judging startup stability, acceleration, braking, reverse, steering, sliding,
ledge behavior, airborne motion, landing, and reset feel.

## Known Limits And Deferred Work

- Collision-envelope, impact-response, filtering, CCD, and contact-observation
  details live in the sibling collision project-system node.
- The chase camera now consumes interpolated presentation state, but deliberate
  response to velocity, orientation, slip, impacts, and airborne state belongs
  to chase-camera mastery.
- Surface grip is currently uniform rather than authored per material.
- There is no automatic stuck-timer recovery. The automatic path covers an
  invalid fall threshold; supported inverted karts require an explicit manual
  recovery request.
- Player air control, anti-roll, and yaw stabilization are not present. The sole
  airborne assist is the accepted passive pitch-stability torque; any expansion
  requires separately accepted policy and observability.
- Mobile uses one proportional two-axis joystick for steering and signed
  forward/brake-reverse intent, plus touch recovery and kart-tap righting.
  Representative device performance acceptance remains deferred to the
  public-demo polish phase, and narrow-screen editor object picking remains
  protected course tooling.
