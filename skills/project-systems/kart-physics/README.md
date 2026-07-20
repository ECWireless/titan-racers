# Kart Physics System

## Purpose

This node documents the accepted Titan Racers kart-physics implementation. It
connects the engine-independent behavior in
`skills/game-concepts/kart-physics/README.md` with the PlayCanvas and Ammo
working methods in `skills/tools/playcanvas-ammo/README.md`.
The human-readable architecture and nested ownership documentation begins at
`docs/kart-system/README.md`.

The system owns deterministic simulation timing, the authoritative dynamic
chassis, wheel support and tire forces, presentation interpolation, physics
telemetry, and explicit reset behavior. Collision mastery and chase-camera
mastery remain separate systems and PR-sized units.

## Runtime Ownership

- `src/game/runtime/fixed-step-clock.ts` accumulates render time, advances the
  simulation at 120 Hz, caps catch-up work at eight steps, and reports discarded
  time.
- `src/game/runtime/playcanvas-application.ts` loads the vendored Ammo build,
  disables PlayCanvas's default variable-cadence tick, owns the animation-frame
  loop, advances whole-world fixed steps, and renders once per display frame.
- `src/game/runtime/ammo-rigid-body.ts` owns direct Ammo rigid-body mass and CCD
  configuration. `src/game/runtime/ammo-wheel-sweep.ts` separately owns the
  reusable Ammo wheel-cylinder sweep allocations and returns copied hits.
- `src/game/kart/dynamic-kart-controller.ts` owns four-wheel support queries,
  suspension forces, grounded tire forces, steering, braking, reverse, rolling
  resistance, speed response, and physics telemetry. It applies no
  target-seeking torque while unsupported.
- `src/game/kart/kart-drive-model.ts` owns mass-independent total motor-force
  requests, symmetric forward/reverse speed falloff, and the fixed equal split
  across configured driven wheels. Unsupported or grip-limited wheels lose
  their unused share. The controller applies each request before the shared
  tire limit; rigid-body mass determines the resulting acceleration.
- `src/game/kart/kart-coasting-model.ts` owns engine-independent rolling and
  aerodynamic resistance laws. The controller applies load-scaled rolling
  force at supported wheels and speed-squared air resistance at the chassis.
- `src/game/kart/kart-brake-model.ts` owns bounded analog service-brake and
  independent handbrake demand plus the future brake-torque-to-wheel-radius
  derivation. The controller proportions four-wheel service-brake force by
  current supported load, while the handbrake keeps its fixed rear-only split,
  before the combined tire limit; mass determines deceleration. The RC
  reference supplies 11.8125 N total handbrake capability rather than a
  percentage of its 26.25 N service-brake capability.
- `src/game/kart/kart-tire-model.ts` owns continuous slip angle, load-derived
  cornering stiffness and force in N/rad, the shared near-zero-speed settling
  blend, peak-to-sliding grip, and
  one combined force budget. Bounded brake requests enter that budget without
  slip-angle tapering, and brake demand does not independently shrink the grip
  coefficient because wheel lock and longitudinal slip are not observed. The
  corrected rolling-speed force
  law removes two former per-kart low-speed stiffness controls. Tire forces
  remain at their wheel contact points; the former hard-braking yaw-lever
  override and rear-only braking stiffness reduction are removed rather than
  retained as tuning or shared policy.
  A fixed shared 2 m/s crossover and 0.12-second lateral settling response
  own the near-zero regime; the former per-kart low-speed reference is removed.
  Independent cornering stiffness has been removed: resolved peak grip times
  current wheel load divided by peak-slip angle derives it per contact. Future
  construction derivation owns tire curve shape, while a tire-surface
  material resolver supplies peak traction, sliding traction, and rolling
  resistance per supported contact. Those resolved values are runtime physical
  inputs, not kart tuning or ephemeral solver state.
- `src/game/kart/kart-suspension-model.ts` owns engine-independent static spring
  compression and the non-negative spring, velocity-damper, and progressive
  bump load calculation. The accepted RC effective wheel spring rate is
  812.5 N/m;
  finite compression travel bounds position-derived force, and the former
  authored 2,500 N per-wheel clipping control is removed.
  Future kart assembly places one approved, versioned, procedurally rendered
  suspension component per wheel. Component-owned envelope, stroke, approved
  spring or cartridge material, and bump-stop material combine with
  assembly-owned anchors and mounting leverage to derive spring,
  matched-damper, bump-onset, and bump-rate outputs; none remains a creator
  numeric control, and engineering component internals is outside the required
  assembly editor.
- `src/game/collision/kart-collision-model.ts` owns default whole-body contact
  material, the accepted collision-envelope measurement, geometry-derived CCD,
  and shared low numerical angular damping. These are not live kart tuning.
- `src/game/kart/kart-rest-settling.ts` owns the fully-supported, input-free
  low-energy eligibility thresholds and shared 1/12-second angular response.
  It derives local corrective torque impulse from the kart's local inertia
  tensor, giving different assemblies the same proportional settling motion
  without storing settlement values in authored kart data.
- `src/game/kart/kart-reference-construction.ts` centrally defines the accepted
  0.0725 m radius by 0.075 m wide wheel sweeps, a 0.30 m wheelbase, a 0.39 m track,
  front-wheel steering, and rear-wheel drive. Support, visual suspension, tire
  forces, and drivetrain allocation consume those roles and positions.
- `src/game/kart/kart-physical-profile.ts` owns the nested resolved physical
  contract consumed by runtime subsystems. `src/game/physics/world-environment.ts`
  separately owns Earth gravity and air density, while
  `src/game/kart/tire-surface-interaction.ts` owns the transitional contact
  fixture. `src/game/kart/kart-development-values.ts`
  owns the temporary flat diagnostic adapter, its bounds, normalization,
  explicit ownership metadata, and conversion into those authoritative
  contracts; runtime systems never consume the flat adapter directly.
- `src/game/kart/kart-drift-smoke.ts` owns supported-wheel tire smoke. Measured
  final lateral tire force times lateral contact speed produces a rear-wheel
  scrub-power presentation signal in watts. Mass-scaled reference thresholds
  and a 0.75 release ratio produce continuous density without
  changing grip. Straight service-brake demand produces no smoke because wheel
  angular velocity and longitudinal slip are not modeled. Countdown
  forward-throttle intent retains an explicit two-layer supported-rear-wheel
  start-hold approximation with a shared 0.35 onset and the same derived
  release ratio.
- `src/game/kart/kart-steering.ts` owns the engine-independent physical lateral
  acceleration boundary and nonlinear speed-sensitive steering-request
  envelope.
- `src/game/kart/kart-righting.ts` owns the engine-independent inverted-pose
  eligibility, shortest righting axis, singularity fallback, and angled-contact
  torque scaling used by manual recovery. A bounded righting-only upright
  landing window derives target/capture impulses from local inertia and releases
  after the first upright four-wheel contact.
- `src/components/solo-time-trial-canvas.tsx` constructs the compound chassis,
  consumes the centralized 1.875 kg, 0.4625 m miniature RC reference with a
  lower body and upper structural/electronics housing, places the physics root
  at their combined center of mass, applies mass properties, connects input
  and resolved owner-specific profiles, snapshots authoritative poses, interpolates the offset
  presentation-only kart visual, drives the chase camera from that visual, and
  coordinates reset, resolved diagnostic values, and editor transitions.
- `src/components/kart-tuning-drawer.tsx` exposes the production, non-modal,
  read-only dynamics inspector with exact grouped resolved values, visible
  owner/classification metadata, and accessible contextual explanations. It
  has no production path for overriding physics, environment, contact, or
  policy values.
- `src/game/course/build-rough-course.ts` creates static rigid bodies and marks
  surfaces that may support the kart with the `drivable-surface` tag.
- `src/game/testing/scene-test-adapter.ts` exposes deliberate non-production
  pose, pause, step, support, load, slip, force, chassis axes, and angular
  velocity hooks for browser verification.

## Data And Update Flow

1. The outer animation-frame loop passes elapsed render time to the fixed-step
   clock.
2. For each required 1/120-second step, driving input enters the dynamic kart
   controller before PlayCanvas advances the whole Ammo world.
3. Each wheel sweeps a finite X-axis cylinder from maximum compression toward
   maximum droop. Collision groups restrict support to drivable surfaces; the
   supported primitive's authored up axis defines its drivable top/cap normal.
4. A supported wheel calculates compression, strut-axis damper velocity, non-negative
   normal load, contact-point velocity, longitudinal force, and lateral force.
   Combined tire force is limited by load and grip. Longitudinal force remains
   at the contact offset; under hard braking, the horizontal lever and stiffness
   of existing lateral force reduce continuously while its vertical offset
   remains physical. With no lateral contact speed there is no lateral force to
   shape, so braking demand cannot create a drift or inject sideways momentum.
5. When all four wheels are unsupported, suspension and tire forces cease.
   Gravity, momentum, low solver damping, and collision response remain
   authoritative; the controller applies no attitude-seeking torque.
6. PlayCanvas advances rigid-body motion and collision response. The resulting
   authoritative kart pose becomes the current presentation snapshot.
7. Once per display frame, the visual child interpolates between the previous
   and current snapshots. The chase camera follows this interpolated visual;
   gameplay, recovery, collision, and telemetry continue to consume the
   authoritative physics root.

## Accepted Invariants

- Gameplay physics advances at 120 Hz independently of render cadence. The
  doubled rate preserves approximately the former samples per suspension and
  rotation event after the 1:4 linear scale change.
- A frame stall cannot trigger an unbounded catch-up spiral.
- The reference kart is one dynamic six-degree-of-freedom compound rigid body
  with an explicit 1.875 kg mass, deliberate local inertia tensor, and a center
  of mass derived from its lower body and upper-housing construction.
- No ordinary driving path writes the authoritative dynamic transform.
- Each wheel independently gains and loses support; an unsupported wheel
  contributes no suspension or tire force.
- The active supported-wheel contact hull, rather than the authored four-wheel
  rectangle, determines static support. Partial support retains forces at the
  remaining contact positions and permits the center of mass to tip outside the
  reduced base.
- Each visible wheel hub, lower A-arm pair, and shock follows the same measured
  suspension travel that drives support force; presentation adds no canned
  chassis bounce.
- The visible chassis has intentional static ground clearance, and the smooth
  lateral wheel-guard envelope prevents deep barrier penetration without
  physical wheel bodies or joints.
- Suspension force is non-negative and position-bounded by finite travel;
  damping remains proportional to measured contact speed. The 812.5 N/m
  default spring construction follows the accepted ramp without an airborne
  attitude controller. Tire force scales with normal load and shares a combined
  grip limit across longitudinal and lateral demand.
- Braking stops forward motion before reverse drive engages. One shared
  0.04 m/s transition threshold prevents direction chatter near exact zero.
- World gravity is fixed at Earth-standard 9.81 m/s² for the demo. The former
  18 m/s² game-feel value is removed; gravity is classified as environment data
  rather than future kart or course authoring.
- The motor no-load speed ceiling defaults to 17 m/s in either direction;
  explicit resistance means actual steady speed remains below that ceiling.
  Reverse uses the same motor-force magnitude as forward, so separate reverse
  speed, force-multiplier, and transition fields are absent from kart tuning.
- The transitional `maximumDriveForce` and `maxForwardSpeed` values are derived
  outputs rather than future authored controls. Motor construction supplies
  torque, no-load angular speed, and mass; gearing, drivetrain efficiency, and
  driven-wheel radius convert those properties into low-speed wheel force and
  motor no-load road speed. The future split should name those meanings
  explicitly rather than preserve the ambiguous tuning names.
- Low-speed forward motor output defaults to 17.8125 N, preserving the accepted
  unconstrained 9.5 m/s² response of the 1.875 kg RC reference. Motor output is
  not multiplied by kart mass.
- Total service-brake capability defaults to 26.25 N, preserving the accepted
  unconstrained 14 m/s² response of the 1.875 kg RC reference. Brake force is
  not multiplied by kart mass. Primitive derivation must obtain this force from
  authored brake torque and wheel radius rather than expose a raw override.
- Total motor demand is divided equally by the number of configured driven
  wheels. An unsupported or grip-limited wheel loses its unused fixed share;
  the solver does not transfer it to another wheel. The ordinary per-wheel
  combined longitudinal/lateral clamp remains authoritative after allocation.
- Rolling resistance defaults to a 0.025 tire/surface coefficient and scales
  with each supported wheel's measured load. Aerodynamic force uses a temporary
  0.025 m² drag area and shared 1.225 kg/m³ air density, acts opposite planar
  chassis velocity at every throttle state, and grows with speed squared.
  Generic per-kart linear damping and the previous mass-cancelling linear
  coasting rate have been removed. Primitive kart derivation must replace the
  temporary drag-area value with a deterministic geometry-derived value and
  resolve rolling resistance from tire and contacted surface policy.
- Shift or standard gamepad west-face input requests rear-wheel handbraking;
  drift remains a continuous tire-slip result rather than an input mode.
- Tire smoke remains presentation-only. For each supported rear wheel,
  `abs(final applied lateral force) * abs(lateral contact speed)` produces a
  scrub-power signal. Shared onset, full-density, and release-ratio policy maps
  that signal continuously across the light and heavy particle layers; values
  are not authored per kart. Straight service braking cannot emit smoke until a
  future wheel-angular-velocity model can prove longitudinal slip. During the
  countdown, meaningful forward throttle can add a stylized two-layer plume
  only at supported rear driven wheels while gameplay holds the kart stationary.
  The countdown path temporarily raises and trails the existing emitter
  placement so stationary particles remain visible, then restores the ordinary
  tire-local placement before driving. Emitter placement follows construction
  scale, while particle size and opacity use one shared stylized legibility
  policy rather than shrinking one-to-one with solid kart geometry. Stopping
  emission lets existing particles fade naturally. None of these paths modifies
  tire force or race timing.
- Every remaining transitional diagnostic development value maps explicitly into a
  nested resolved kart subsystem profile or the separate world environment.
  Shared smoke, near-zero tire, grounded rest-settling, and manual-righting
  policy are deliberately outside resolved kart physics. Default
  chassis-contact material comes from authored collision construction, while
  low numerical angular damping and CCD ratios come from shared solver policy;
  none is exposed as a compensating per-kart override. Controlled
  non-production scene-adapter changes apply immediately, including gravity in
  the physics world. The production inspector only reads the resolved values.
  The chase-camera speed envelope follows the shared motor no-load speed.
  Manual-righting angular
  impulse derives from local-axis inertia and the angular speed required for a
  shared 180-degree recovery over the derived airtime of a
  kart-length-relative clearance hop (0.08 m on the current reference),
  including a small shared contact-loss allowance; lift impulse derives
  from mass, gravity, and that clearance target.
  Eligibility, posture scaling, support probing, and cooldown are shared
  recovery policy. Test-fixture development values never persist beyond the
  controlled scene.
- During the temporary handling-polish workflow, an unmodified `T` key opens or
  closes the read-only Kart Dynamics Inspector only while an active race owns
  keyboard input. No visible opener is rendered, and closing returns focus to
  the race canvas. This intentionally leaves touch-only mobile sessions without
  inspector access.
- Opening the drawer clears retained driving input. On coarse-pointer layouts
  it temporarily removes the underlying touch-driving group so inspector help
  and close controls cannot overlap live steering or pedals. Pause and finish
  dialogs remove the inspector from interaction until racing resumes.
- Obscure controls expose concise explanations on pointer hover, keyboard
  focus, or tap. Escape dismisses help without pausing the race, the visible
  explanation remains hoverable, and each numeric output retains an accessible
  description even while the visual tooltip is closed.
- Steering authority uses an 18-degree mechanical lock at low speed, then a
  shared 45% margin below the lower nominal grip or rollover boundary. The
  command includes the no-slip geometric wheel angle plus half of the transient
  tire-slip demand needed to build cornering force. Front and rear slip largely
  cancel in steady-state bicycle geometry, so adding a complete axle slip angle
  would double-count the request. For the
  current 0.30 m wheelbase, 0.39 m track, 0.08 m nominal COM height, 1.42 peak
  grip, and Earth-standard 9.81 m/s² gravity, this produces about 2.62 degrees
  at 8.5 m/s and 1.50 degrees at 17 m/s. Reverse consumes the same
  speed-magnitude curve. The
  previous independently tuned six-degree high-speed angle is removed. One
  shared 0.225-second center-to-current-full-lock duration derives about 80
  degrees/s at low speed and 6.66 degrees/s at 17 m/s; the former per-kart
  response-rate field is also removed.
- The controller retains one signed center-equivalent steering request and
  derives each front wheel through Ackermann geometry about the steered-axle
  centerline. At the current 18-degree left request, the inside-left wheel uses
  about 22.39 degrees and the outside-right wheel about 15.02 degrees; right
  turns mirror those values. Visual pivots, wheel sweeps, tire axes, and debug
  telemetry consume the same per-wheel angle.
- Developer diagnostics distinguish the center-request geometric turn radius
  from the solver-observed radius (`abs(forward speed / local yaw rate)`). Null
  represents straight or negligible motion; these readouts never drive runtime
  state.
- The tire solver applies a shared 1.15 grip-safety ratio to the axle trailing
  the current direction of travel: physical rear in forward motion and
  physical front in reverse. This preserves mild, recoverable understeer
  without turning a permanent rear multiplier into reverse instability. It is
  versioned gameplay policy, never a per-kart override.
- Partial support applies forces at the remaining wheel locations and never
  invokes an upright lock.
- Airborne motion preserves gravity, linear momentum, angular momentum, drag,
  and ordinary rigid-body contacts. Ordinary ramp flight has no target-seeking
  pitch or upright controller.
- Automatic below-course recovery and ordinary upright reset requests use the
  race session's accepted checkpoint recovery, clear momentum, and enter its
  recovery lifecycle.
- A manual recovery request while the kart is at least 120 degrees inverted
  and immediately above a drivable surface instead applies bounded roll and
  lift impulses at the current transform. Axis-projected derived inertia scales
  the shared angular-speed target, while mass and Earth gravity scale the shared
  lift-clearance target. Steeper eligible poses receive a continuous torque
  boost; a bounded righting-only upright landing window then derives angular
  capture impulses from local inertia and releases after upright four-wheel
  contact. No transform, camera, or race-state reset occurs. A 450 ms cooldown
  absorbs repeated eligible requests.
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
- `tests/kart-drive-model.spec.ts` for mass-independent motor force, mass-derived
  acceleration, symmetric directional speed falloff, unsupported driven wheels,
  unequal wheel limits, reverse allocation, and invalid capacities;
- `tests/dynamic-kart-controller.spec.ts` for nonlinear speed-derived steering,
  reverse symmetry, continued authority reduction beyond no-load speed, grip
  versus rollover ownership, the shared steering-request margin, and normalized
  response duration plus mirrored Ackermann wheel angles;
- `tests/kart-coasting-model.spec.ts` for quadratic aerodynamic force,
  drag-area/mass deceleration relationships, load-proportional rolling force,
  mass-independent rolling deceleration, direction, and low-speed continuity;
- `tests/kart-brake-model.spec.ts` for fixed total brake force, mass-derived
  deceleration, load-aware four-wheel service-brake allocation, bounded analog
  demand, invalid inputs, and brake-torque versus wheel-radius force;
- `tests/kart-suspension-model.spec.ts` for load/spring static compression,
  motion-only damping, progressive bump onset, and un-clipped hard-landing
  force;
- `tests/kart-tire-model.spec.ts` for velocity-derived slip angle, equal force
  at equal slip angle across rolling speeds, linear cornering stiffness,
  low-speed settling, and peak-to-sliding grip; browser fixtures verify the
  combined longitudinal/lateral force budget;
- `tests/home.spec.ts` includes a deterministic recovery A/B: sustained
  throttle/steer/handbrake is compared with release, brief counter-steer, then
  centering; the recovery path must reduce terminal rear slip and yaw rate by
  at least 40 percent relative to sustaining the slide;
- `tests/playcanvas-runtime.spec.ts` for engine startup, default-tick
  cancellation, callback/update/render ordering, exact manual steps, listener
  cleanup, animation-frame cancellation, and idempotent teardown;
- `tests/kart-tuning.spec.ts` for complete development bounds, finite-value
  handling, clamping, related-threshold ordering, explicit ownership metadata,
  and conversion into nested runtime contracts;
- `tests/kart-drift-smoke.spec.ts` for final-force scrub power, continuous
  density, shared release hysteresis, absence of invented straight-line braking
  smoke, and supported rear-only countdown burnout intent;
- `tests/kart-righting.spec.ts` for inversion eligibility, shortest-axis
  selection, the exactly inverted fallback, angled-contact torque scaling, and
  mass/inertia-equivalent recovery;
- `tests/kart-rest-settling.spec.ts` for bounded rest eligibility and
  mass/inertia-equivalent corrective angular response;
- `tests/home.spec.ts` for finite wheel support, visible clearance, springy ramp
  landing, construction-derived full-speed ramp pitch, static equilibrium,
  acceleration, configured top
  speed, braking, reverse, forward and reverse steering, stable sustained
  moderate-speed powered cornering, high-speed natural and brake-induced drift,
  longitudinal and lateral load transfer, grip saturation and recovery,
  wheel-specific ledge
  support, tipping, airborne rotation, landing, invalid-state recovery,
  speed-dependent live coasting, production read-only dynamics-inspector hotkey behavior,
  tooltip accessibility, ownership labels, and key
  completeness, controlled-fixture gravity and camera-envelope propagation, no straight-line
  braking smoke without measured slip, stationary countdown burnout smoke, complete
  inspector interaction isolation, responsive containment, editor transitions,
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
- Mass properties still use an explicit one-box chassis approximation. The
  primitive kart derivation must combine part mass, center of mass, local shape
  inertia, and part distance from the combined center rather than treating
  internal component placement as inertially invisible.
- Wheel dimensions, positions, and driven/steered roles remain rebuild-time
  hard-coded scene data. Primitive kart derivation must make one validated
  wheel contract authoritative for support, visuals, handling, drivetrain, and
  collision protection without turning width into a direct grip multiplier.
- There is no automatic stuck-timer recovery. The automatic path covers an
  invalid fall threshold; supported inverted karts require an explicit manual
  recovery request.
- Player air control, anti-roll, yaw stabilization, and target-seeking airborne
  pitch assistance are not present. Any future expansion requires separately
  accepted policy and observability.
- Mobile uses one proportional two-axis joystick for steering and signed
  forward/brake-reverse intent, plus touch recovery and kart-tap righting.
  Representative device performance acceptance remains deferred to the
  public-demo polish phase, and narrow-screen editor object picking remains
  protected course tooling.
