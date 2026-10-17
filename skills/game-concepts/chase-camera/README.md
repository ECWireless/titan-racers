# Chase Camera

**Maturity:** Validated (accepted 2026-07-11).

## Purpose and Scope

This node defines the gold-standard chase-camera behavior for Titan Racers.
Read it before changing playable camera framing, heading, look-ahead, damping,
speed response, slip presentation, impact response, airborne behavior,
obstruction handling, or reset behavior.

Engine mapping lives in
[`tools/playcanvas-ammo/chase-camera`](../../tools/playcanvas-ammo/chase-camera/README.md);
the shipped system lives in
[`project-systems/chase-camera`](../../project-systems/chase-camera/README.md).

## Standard

Build a motion-led chase camera that makes the kart and upcoming route readable
while communicating speed, slip, impacts, and airtime. Use actual presentation
pose and authoritative motion state rather than steering input to determine the
shot. Smooth independent camera signals deliberately, keep every expressive
response bounded, and snap all retained state at discontinuities.

The camera is a presentation system. It must observe the kart without changing
physics, controls, collision response, recovery, or race state.

## Desired Outcome

The player should be able to steer by looking through the kart toward the route,
understand when the kart is sliding rather than pointing where it is travelling,
feel a hard impact without losing the scene, and judge a landing while airborne.
The camera should feel stable rather than rigid, expressive rather than noisy,
and quick to recover from exceptional motion.

In particular:

- routine acceleration and turning keep the kart in a consistent readable
  region of the frame;
- speed creates modest additional forward visibility and field of view;
- a controlled slide produces bounded heading lag and lateral composition that
  exposes the difference between orientation and travel direction;
- a spin cannot make the camera orbit violently or lose the route indefinitely;
- only material impacts create a short directional response;
- airborne framing keeps a stable horizon and useful landing visibility;
- nearby walls and corners cannot sit between the camera and kart; and
- reset, recovery, mode changes, and controlled test teleports produce an
  immediately coherent shot with no smoothing trail from the old pose.

## Core Principles

1. **Motion leads the shot.** Smoothed planar velocity, not control input,
   predicts where the player needs to see.
2. **Orientation still matters.** Kart forward supplies identity and the
   low-speed/reverse fallback; velocity influence grows only when it is useful.
3. **Slip is readable, not chased literally.** Expose a bounded difference
   between facing and travel direction without attaching the camera freely to
   either vector.
4. **Composition is layered.** Position, aim, heading, vertical response, field
   of view, obstruction, and transient impulses remain distinct tunable signals.
5. **Damping is time-based.** Response is stable across supported render rates
   and does not use frame-count-dependent interpolation.
6. **The horizon is a safety rail.** Ordinary roll and pitch may inform framing,
   but they must not make the view inherit violent chassis rotation.
7. **Noise does not become motion.** Filter predictive inputs and use deadbands
   or thresholds before small support, contact, or velocity changes reach the
   camera.
8. **Exceptional responses are bounded.** Impacts, spins, landings, and
   obstruction corrections have explicit caps and recovery rates.
9. **Discontinuities snap.** Teleports and mode changes invalidate camera
   history instead of being treated as very fast ordinary motion.
10. **The camera never drives gameplay.** Authoritative simulation and gameplay
    decisions do not consume camera-smoothed state.

## Recommended Model

### Motion frame and heading

Construct a stable motion frame from:

- interpolated presentation position and orientation for visual coherence;
- authoritative linear velocity for speed and travel direction;
- support state and vertical velocity for grounded/airborne classification; and
- observed collision severity and direction for transient impact response.

Project velocity onto the driving plane before deriving normal chase heading.
At low planar speed, use kart forward so stopping, starting, and reversing do
not leave the camera with an undefined or stale direction. As forward speed
increases, blend toward travel direction only enough to improve route
prediction. Treat reverse explicitly so the camera does not suddenly flip 180
degrees while the player is braking through zero.

Filter velocity and heading before using them. Clamp angular catch-up so a spin
or solver discontinuity cannot produce an unbounded orbit. When orientation and
travel direction disagree, retain enough orientation influence to show the
kart's slip angle and enough motion influence to keep the exit route visible.

### Framing and look-ahead

Compose a base camera anchor behind and above the kart. Derive forward
look-ahead from smoothed planar velocity with explicit minimum and maximum
bounds. Add only a bounded lateral offset from signed slip so the kart can move
within a controlled screen region without the camera swinging to match every
degree of oversteer.

Keep kart position and aim-target response separate. Horizontal and vertical
damping may differ: turns need quick readable aim, while bumps and suspension
motion should not bob the entire view. Predictive look-ahead must be smoothed
because raw extrapolation amplifies noisy target motion.

Modestly widen field of view and, if validated, chase distance with speed.
Use a stable speed envelope, hysteresis or smoothing, and conservative bounds.
The effect should communicate pace without becoming a zoom pulse during
braking or wall contact. Maintain separate desktop and narrow-mobile base
composition when needed, but preserve the same behavioral rules.

### Slip and spin

Derive signed slip from the horizontal angle between kart forward and planar
velocity once speed exceeds a reliable threshold. Shape and cap the signal
before it affects camera heading or lateral framing. Small tire-force noise
inside ordinary straight driving should produce no visible response.

For large slip or spin, prioritize stable composition over literal following.
Limit heading slew, reduce predictive distance when travel direction becomes
unstable, and recover toward the accepted motion frame without snapping. The
player must retain visual evidence of rotation while keeping the kart and
nearby course readable.

### Impacts

Classify impact response from observed contact direction and a stable severity
measure such as normal approach speed or solver impulse. Ignore sustained wall
rubs and low-energy contacts. A qualifying impact may apply a short, decaying,
directional offset or rotational impulse to the camera presentation.

Impact response must:

- have onset thresholds, magnitude caps, duration, decay, and retrigger policy;
- preserve the kart and recovery route in frame;
- avoid stacking manifold points or continuous contact into repeated shake;
- avoid random high-frequency noise as the primary response; and
- remain presentation-only.

Camera response does not replace physical collision feedback. It should confirm
a material hit, not exaggerate every contact.

### Airborne and landing behavior

When support is lost, retain a world-up reference and soften vertical following
so chassis pitch, roll, and suspension discontinuities do not rotate or bob the
view directly. Continue to show velocity direction and bias the aim toward the
likely landing region without predicting an elaborate trajectory.

Use support history or a short transition policy so single-step wheel-support
changes do not toggle the shot. On landing, absorb the vertical discontinuity
with bounded damping, then return promptly to grounded response. A landing may
feel weighty, but the camera must not hide the next steering decision.

### Obstruction handling

Query from a stable kart-side pivot toward the desired camera position. When
course geometry blocks the shot, move the camera toward the pivot with a safety
margin so the obstruction does not cross the near plane or hide the kart.
Correction should be fast enough to prevent clipping; release toward the
desired chase distance should be smoother to avoid popping.

A volume sweep that represents the camera near plane is the conceptual
standard. A ray is an acceptable first implementation only if representative
wall and corner tests show no visible edge or near-plane clipping. Exclude the
kart and non-obstructing helpers from the query.

### Reset and lifecycle

Expose one explicit snap/reset operation that reinitializes every retained
signal from the new kart state: position, aim, heading, filtered velocity,
speed/FOV response, slip, airborne transition, obstruction distance, and impact
offset. Invoke it for gameplay reset, invalid-state recovery, test teleport,
mode changes, and initial scene readiness.

Pause and resume must not integrate a large elapsed time. Teardown must release
listeners and retained entity references.

## Failure Modes

Reject implementations that:

- derive heading or look-ahead directly from steering input;
- attach rigidly to the complete kart rotation;
- follow raw velocity or slip without low-speed handling and filtering;
- use one smoothing constant for every camera signal;
- lerp by a fixed per-frame fraction;
- allow speed FOV, impact shake, or spin response to exceed explicit bounds;
- shake on every contact point or throughout a wall scrape;
- flip behind reverse velocity while braking through zero;
- inherit airborne roll or pitch strongly enough to tilt the horizon;
- let an obstruction remain between the camera and kart;
- ease slowly across a reset or teleport; or
- feed camera state back into physics or gameplay decisions.

## Validation

Accept with repeatable automated scenarios and hands-on desktop and
narrow-mobile QA covering: rest, launch, top speed, braking, and reverse with no
heading flip or FOV pulse; equivalent framing across 30, 60, and 120 Hz render
cadence; readable controlled slip; spin recovery without orbiting; no response
to wall rubs and one capped response to real impacts; a stable horizon through
ramps and landings; walls and corners that never hide the kart or trap the
camera; immediate snaps on reset, recovery, mode changes, and teleports;
and diagnostics that explain heading blend, slip, support, obstruction, impact,
FOV, and snaps.

## Non-Goals

Out of scope:

- player-controlled camera orbit or look-back input;
- cinematic replay, spectator, ghost, multiplayer, or split-screen cameras;
- camera behavior authored per final Agricultural Zone segment;
- motion blur, chromatic aberration, depth of field, or other post-processing;
- procedural camera animation unrelated to observed kart state;
- changing kart physics, collision response, input, recovery policy, or race
  progression; or
- a general camera framework for future modes.

## Sources

- [Unity Cinemachine Composer: look-ahead, smoothing, damping, and composition
  zones](https://docs.unity3d.com/Packages/com.unity.cinemachine@2.6/manual/CinemachineAimComposer.html)
- [Unity Cinemachine Orbital Transposer: motion heading, target orientation,
  and axis damping](https://docs.unity3d.com/Packages/com.unity.cinemachine@2.6/manual/CinemachineBodyOrbitalTransposer.html)
- [Unity Cinemachine damping semantics](https://docs.unity3d.com/Packages/com.unity.cinemachine@2.6/api/Cinemachine.Cinemachine3rdPersonFollow.Damping.html)
- [Unreal Engine Spring Arm: camera lag and obstruction
  correction](https://dev.epicgames.com/documentation/unreal-engine/quick-start-guide-to-components-and-collision-in-unreal-engine-cpp)
- [Godot SpringArm3D: near-plane-aware third-person camera obstruction
  handling](https://docs.godotengine.org/en/stable/tutorials/3d/spring_arm.html)
- [John Nesky, Smoothing Camera Motion, Game Developer Magazine, September
  2011](https://media.gdcvault.com/GD_Mag_Archives/GDM_September_2011.pdf)
- [David H. Eberly, Fundamentals of Real-Time Camera Design, GDC
  2005](https://media.gdcvault.com/gdc05/slides/GD_Haigh-Hutchinson_FundamentalsReal-TimeCameraDesign.pdf)
