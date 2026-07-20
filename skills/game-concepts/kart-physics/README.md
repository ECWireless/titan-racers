# Kart Physics

**Maturity:** Validated. The feature lead accepted this engine-independent
standard and its implemented fixed-step kart system on 2026-07-10 after
repeatable automated and hands-on verification.

## Purpose and Scope

This node defines the gold-standard behavior model for Titan Racers kart
physics. Read it before changing chassis dynamics, wheel support, suspension,
traction, steering, braking, reverse, airborne behavior, landing, or recovery.

It deliberately does not prescribe an engine API. Tool-specific implementation
guidance belongs under [`../../tools/`](../../tools/README.md), while the actual
shipped data flow and source ownership belong under
[`../../project-systems/`](../../project-systems/README.md).

## Focused Children

- [`wheel-suspension/`](wheel-suspension/README.md): accepted extension for
  finite-radius wheel support, visible ride height, articulated suspension, and
  readable landing compression.

## Standard

Build the kart as a genuine dynamic rigid body with wheel-level support and
force application, then layer a small number of explicit, bounded arcade
assists on top. Physics establishes the truth of the motion; assists make that
truth readable, responsive, and enjoyable without replacing it.

This hybrid standard rejects both extremes:

- a simulation whose realism makes the kart fragile, opaque, or unpleasant to
  tune, and
- scripted movement that overwrites momentum, orientation, contacts, or impact
  response to manufacture a driving pose.

## Desired Outcome

The kart should feel immediate and forgiving on the ground while remaining a
credible physical object. Acceleration, braking, steering, weight transfer,
sliding, ledge tipping, flight, landing, and collision response should belong
to one coherent motion model. A player should be able to anticipate what will
happen from the kart's pose, velocity, contact state, and input.

In particular, leaning over a platform edge must not remain artificially flat.
The supported wheels, projected center of mass, kart orientation, and momentum
must determine whether and how the kart rotates and falls.

## Core Principles

1. **One physical truth.** Normal driving never writes a desired world pose or
   locks the chassis upright.
2. **Support is local.** Determine support independently at the wheel/contact
   locations, never from one chassis-center grounded flag.
3. **Forces act where they arise.** Suspension and tire forces act at their
   wheel or contact positions so they can generate pitch, roll, and yaw.
4. **Grip is finite.** Longitudinal and lateral tire forces share a load- and
   surface-dependent force budget.
5. **Momentum survives state changes.** Leaving the ground, landing, and being
   hit do not silently discard linear or angular momentum.
6. **Assists are visible policy.** Every non-physical assist is named, bounded,
   independently tunable, and removable for diagnosis.
7. **Repeatability precedes tuning.** Gameplay physics advances on a fixed
   simulation step, independent of render cadence.
8. **Parameters describe intent.** Expose coherent, designer-facing controls
   with stable units and distinct responsibilities rather than piles of magic
   multipliers.

## Recommended Model

### Chassis and mass properties

Use one dynamic, six-degree-of-freedom chassis with explicit mass, center of
mass, and inertia. Derive initial inertia from a plausible chassis volume and
mass distribution, then tune it deliberately. Treat center-of-mass and inertia
changes as handling changes, not generic stability knobs.

Physical wheel bodies and drivetrain articulations are not required. The
visual wheels should follow the support, steering, and suspension solution
while the chassis remains the authoritative rigid body. See the focused
[`wheel-suspension`](wheel-suspension/README.md) extension when wheel volume,
visible ride height, articulated suspension, or landing compression is in
scope.

### Wheel support and suspension

Evaluate four independent wheel support queries at the real wheel locations.
For each supported wheel, determine at least:

- the contact position, road plane, normal, and surface grip,
- suspension compression and compression velocity,
- spring and damper response,
- the resulting non-negative normal load, and
- point velocity at the contact, split into longitudinal and lateral axes.

The spring may push the chassis away from the surface but must not pull it
toward a missing surface. Bound suspension travel and use a progressive bump
stop or an equivalent stable limit response near maximum compression.

For buildable karts, derive wheelbase, track width, support footprint, and
driven/steered roles from bounded authored wheel and drivetrain placement.
Wheelbase and steering angle establish the low-speed geometric turning
reference; track width and center-of-mass height establish the lateral
load-transfer and rollover reference; the convex hull of currently supported
contacts establishes the static support base. A center-of-mass projection
outside that active base must be free to tip the chassis.

Wheel radius converts drivetrain torque and angular speed into ground force and
linear speed, while also changing obstacle clearance and the finite support
query. Tire width changes mass, packaging, support volume, and collision
envelope, but must not directly multiply Coulomb grip: with the same compound
and load, available tire force remains the grip coefficient times normal load.
Driven and steered roles require corresponding functional components rather
than arbitrary per-wheel flags in player-authored data.

### Tire forces and controls

Compute acceleration, braking, reverse, and lateral correction at each
supported wheel. Scale the available result by tire load and surface grip, then
limit the combined longitudinal and lateral force so braking and turning must
share traction.

The model may be simpler than a road-car tire simulation, but grip breakaway
and recovery should be progressive. It must not provide full lateral grip at
zero load or add independent unlimited forces for every control axis.

Ordinary moderate-speed cornering should bias toward mild understeer;
deliberate excess speed, steering, braking, or throttle may still produce
continuous tire slip. Derive that balance from accepted physical causes such as
tires, mass distribution, geometry, and suspension load—not a direct balance
stat. For the demo's simplified tire solver, one shared safety policy may give
the axle trailing the current direction of travel a modest grip margin. The
margin must swap axles in reverse, remain identical for every kart, and stay
versioned as policy rather than masquerading as tire construction.

Do not reduce rear cornering stiffness merely because brake input is hard.
Four-wheel service braking should remain axle-balanced, and a rear handbrake
already creates its intended imbalance by consuming only the rear tires'
combined longitudinal/lateral budget.

Use separate designer-facing behavior for:

- drive response and approach to top speed,
- service braking,
- shared brake-to-reverse engagement policy,
- steering input response and maximum steering by speed,
- lateral grip and its breakaway/recovery curve,
- rolling resistance and speed-dependent drag, and
- shared baseline front/rear recovery policy.

The demo world uses Earth-standard 9.81 m/s² gravity as one fixed environment
value. It is not kart construction, per-course handling tuning, or a creator
override. If a future release intentionally supports alternate worlds, gravity
must enter through a versioned environment definition and trigger complete
handling validation rather than silently varying by kart.

For buildable karts, express low-speed motor capability as bounded tractive
force available across the driven wheels rather than as a target acceleration
that is multiplied by total kart mass. Actual acceleration should emerge from
applied drive force, total mass, and the shared tire-force budget. A reusable
functional motor component may derive both mass and available drive force from
its bounded component construction; increasing motor size may improve
acceleration with diminishing
returns, shift the center of mass, increase rotational inertia, and eventually
reach the traction limit. Do not cancel those construction consequences by
granting heavier karts proportionally more motor force outside the authored
motor derivation.

Motor construction, gearing, drivetrain efficiency, and driven-wheel radius
must derive both low-speed wheel force and motor no-load road speed; neither is
an independently authored kart statistic. With gear ratio `G` expressed as
motor rotation per wheel rotation, low-speed wheel force is approximately
`motor torque * G * efficiency / wheel radius`, while no-load road speed is
approximately `motor no-load angular speed * wheel radius / G`. Increasing `G`
therefore raises launch force while lowering the no-load road speed. Tire grip
may cap the applied launch force, and rolling plus aerodynamic resistance may
make actual steady speed lower than the derived no-load value.

Treat motor output as one total force budget before driven-wheel distribution.
The Demo v1 reference drivetrain has a fixed equal split across its configured
driven wheels. Apply each wheel's share only up to that wheel's current force
limit; if the wheel is unsupported or grip-limited, discard the unused share
rather than transferring it across the axle. This intentionally simple open
differential approximation must not create support, exceed any tire's shared
longitudinal/lateral budget, or become a creator-authored tuning surface.

Do not use inertia, a target slowdown rate, or generic rigid-body damping as
the kart's coasting model. Apply explicit resistance forces instead. Rolling
resistance is approximately tire/surface coefficient times supported normal
load, so its force grows with mass while its resulting deceleration is roughly
mass-independent. Aerodynamic drag is approximately one half air density times
drag area times speed squared, so equal-shape heavy karts retain high-speed
motion longer and doubling speed requires about four times the drag force and
eight times the mechanical power to overcome it. Derive drag area from bounded
kart geometry under a shared aerodynamic policy; do not expose an arbitrary
creator drag override. Smooth only the rolling-force direction very near zero
speed to avoid numerical reversal.

Treat service-brake capability like motor capability: authored hardware
provides a bounded total torque or force, not a target deceleration multiplied
by kart mass. Ground braking force is total brake torque divided by wheel
radius, and actual force is the lesser of hardware capability and the tires'
remaining combined force budget. Hardware-limited heavy karts therefore slow
less quickly; tire-limited braking approaches the mass-independent `mu * g`
limit. Speed still matters because kinetic energy and constant-deceleration
stopping distance both grow with speed squared. Brake heat and fade may remain
out of scope without replacing these force relationships with hidden handling
penalties.

The Demo v1 sealed four-wheel service brake uses shared load-aware
proportioning: request each supported wheel's fraction of the bounded total
force according to its current normal load, then apply the ordinary combined
tire clamp. This keeps braking stable as load transfers forward without adding
a creator brake-bias stat. The rear handbrake intentionally does not use that
proportioning.

Treat the rear handbrake as its own actuator with independent bounded total
force or torque, not as a percentage of service-brake capability. Distribute
that request only across the configured rear handbraked wheels and pass it
through their ordinary combined tire budgets. Future construction derives both
brake systems from their hardware and wheel radius without linking their
strengths accidentally.

For a reversible electric motor using the same gearing, backward drive should
use the same low-speed force and no-load speed magnitudes as forward drive,
with only the sign changed. Do not add per-kart reverse force or speed controls
unless authored hardware actually differs by direction. A combined
brake/reverse input must apply service braking while meaningful forward motion
remains, then enable backward motor force only inside one small shared
near-zero velocity threshold. That threshold exists to prevent solver chatter
around exact zero and belongs to controller policy, not kart construction.

Steering authority must decrease progressively with forward or reverse speed.
Preserve enough low-speed lock for deliberate maneuvering, but do not let a
full digital steering input retain the same sharp wheel angle near top speed.
Input response and maximum angle are separate behaviors: reducing only response
delays an overly sharp turn, while reducing only the angle can still create an
abrupt initial weight transfer. Validate both the settled turning radius and
the onset of steering at representative low, medium, and high speeds.

Do not express that reduction as an independently authored high-speed wheel
angle. Derive a nominal physical lateral-acceleration boundary as the lower of
`peak grip * gravity` and `gravity * track width / (2 * center-of-mass height)`.
Apply one shared steering-request margin below that boundary, then solve the
bicycle-model relationship backward:
`angle = atan(wheelbase * requested acceleration / speed squared)`. Clamp the
result to the construction-derived mechanical steering lock near zero speed.
This policy limits only the wheel angle requested by player input; it must not
write lateral acceleration, yaw, or velocity. Actual tire force, slip, surface
conditions, support, and rigid-body motion remain authoritative.

If steering actuator dynamics are not physically modeled, keep wheel-angle
response as one shared normalized controller duration rather than a per-kart
degrees-per-second value. Derive the active rate as the current permitted angle
divided by that duration. This prevents a small high-speed target from being
reached almost instantly while preserving the accepted low-speed response.
Only a future authored steering actuator with explicit mass, packaging, torque,
and gearing tradeoffs should make response vary by kart.

Treat the input-facing steering angle as a bicycle-model center-equivalent
request, then derive the two steered-wheel angles through Ackermann geometry.
For center radius `R`, wheelbase `L`, and track `T`, the inside angle is
`atan(L / (R - T/2))` and the outside angle is `atan(L / (R + T/2))`.
The inside wheel must turn more sharply because it follows the smaller circle.
Use the authored steered-axle centerline rather than the center of mass as the
lateral reference. Do not expose Ackermann percentage as a creator tuning knob
while advanced racing-tire slip geometry remains out of scope.

Keep requested geometry separate from observed motion in diagnostics. The
center request implies a geometric radius `wheelbase / tan(abs(angle))`, while
the runtime chassis path is `abs(forward speed / yaw rate)`. A straight wheel
or negligible speed/yaw has no finite diagnostic radius. Never feed the
observed radius back into steering authority; its difference from the requested
radius is evidence produced by tire slip, load, surfaces, and the solver.

Drift is an ordinary tire state, never a toggled handling mode. Derive a
continuous slip angle from each supported wheel's longitudinal and lateral
contact velocity. Before the force envelope clamps it, derive lateral force
from load-aware cornering stiffness in newtons per radian times slip angle—not
from raw lateral speed. Derive that stiffness per contact as peak grip
coefficient times current wheel load divided by peak-slip angle, so the linear
response reaches the resolved force ceiling at the documented breakaway point.
Two equal tires at equal load and slip angle therefore request equal force even
when their speeds differ; speed already changes the required
cornering acceleration through `speed squared / radius`. Tire response should
rise toward peak grip, then fall
progressively toward a lower sliding-friction plateau as slip grows. The same
curve applies whether slip began through speed, steering, service braking,
rear-wheel handbraking, acceleration, weight transfer, a surface transition,
or an impact.

At negligible rolling speed, do not interpret the unstable ratio between tiny
forward and lateral velocities as a dramatic drift. One shared 2 m/s tire
reference blends the ordinary slip-angle force law into the shared 0.12-second
lateral settling response. Both values are solver policy, identical for every
kart, tire, surface, and course; neither is construction or tuning.

Separate tire construction from the contacted environment. Derived tire
construction owns the response curve's character: breakaway slip angle,
developed-slide slip angle, and a sliding-retention tendency. The
tire-and-surface material pair resolves peak traction, sliding
traction, and rolling resistance independently at every supported wheel. The
runtime solver derives cornering stiffness from resolved peak traction, current
wheel load, and peak-slip angle, then combines those inputs with current slip;
neither
the final coefficients nor their resulting forces are persisted as kart
overrides. For the demo, surfaces primarily scale available traction and
resistance rather than requiring a completely independent five-parameter tire
curve for every possible material pair.

Service braking and a rear-biased handbrake must consume the same combined
longitudinal/lateral tire-force budget as every other wheel force. A handbrake
input may request rear-wheel braking, but it must not set a drift flag, apply a
yaw impulse, overwrite angular velocity, or directly switch grip coefficients.
Low-speed handbraking should primarily slow the kart; useful rotation requires
speed, lateral demand, and the resulting physical imbalance. Counter-steering,
throttle modulation, reduced slip, and recovered wheel load must allow grip to
return progressively.

Treat counter-steering as a transient recovery input, not a new sustained
cornering command. Release rear brake/drive demand, counter-steer toward the
rear slide long enough to arrest yaw, then return toward center as grip returns;
holding full opposite lock can create a second slide in the other direction.

Without wheel angular velocity and longitudinal slip ratio, brake demand cannot
prove that a wheel is locked. Do not shrink the tire's total grip coefficient
from pedal demand alone. Braking instead consumes the existing combined-force
budget alongside lateral force; the ordinary peak-to-sliding curve remains the
only grip envelope. A future wheel-lock model may lower kinetic grip only from
observed longitudinal slip. This is continuous combined-slip behavior, not a
drift state or a source of artificial momentum.

Likewise, do not taper the driver's requested brake force merely to preserve
speed during lateral slip. Submit the full bounded actuator request and let the
combined tire budget determine the force that reaches the ground. Releasing or
modulating the input—not an invisible slip-angle assist—restores lateral budget.

If hard-braking slides retain too much yaw, fix the requested forces,
front/rear balance, load response, or combined tire budget. Always apply tire
force at its physical contact point: moving the application point toward the
center of mass silently shortens the lever and hides the model error. Because
zero lateral contact speed still produces zero lateral force, braking demand
alone cannot create a drift. Recovery must remain continuous and must never
lock heading, inject lateral momentum, or overwrite angular velocity.

Tire smoke is presentation evidence of dissipative tire-road slip, not a force
or handling mode. When wheel angular velocity is modeled, longitudinal slip
ratio is the correct source for braking and powered-wheel smoke. Until that
state exists, brake demand and tire-force utilization do not prove wheel lock
and must not create straight-line smoke. Ordinary smoke may use supported rear
tire lateral scrub power—absolute final applied lateral force times absolute
lateral contact speed—as a presentation proxy for dissipated power. Map shared
onset and full-density policy continuously, derive the lower release threshold
from one shared hysteresis ratio, and never feed the result back into grip. A
countdown burnout may visualize forward-throttle intent with a stronger
two-layer plume at supported driven wheels while the start hold prevents motion.
Treat that as an explicit stylized approximation. Construction owns its wheel
attachment position, but shared presentation policy may apply a larger visual
scale and stronger opacity than miniature solid geometry needs so the cue stays
screen-readable. Stop new emission promptly when input or support is lost while
allowing existing particles to fade.

Chassis lean during sharp turns and drift must come from the rigid body's mass
properties, tire-force application points, and independently loaded suspension.
Tune center-of-mass height, roll inertia, spring rate, and damping together so
outside suspension compresses, inside suspension extends, and the body rolls
toward the outside of the turn. Do not rotate a presentation child, apply a
canned roll torque, or add artificial downward force to imitate load transfer.
The accepted response must settle after grip recovery and retain stable rest,
ledge, ramp, landing, and collision behavior.

For the demo builder, represent suspension as one approved functional
suspension-unit component per wheel rather than asking creators to assemble or
engineer miniature coils, damper pistons, and bump stops. The reusable component
definition may procedurally render an outer damper body, shaft, representative
coil, bump-stop collar, mounting eyes, and connected control arms from ordinary
bounded primitives. Component-definition inputs are construction facts such as
assembly length, stroke, diameter, an approved spring or cartridge material,
and bump-stop material—not spring or damping statistics. The kart assembly
document references a versioned component, places its chassis and hub anchors,
and cannot edit those internals.

Derive spring rate, matched-damper rate, bump onset, and bump rate from the
functional unit and its mounting leverage. Effective wheel spring and damping
rates scale approximately with motion ratio squared. Keep the demo damper a
documented, internally matched part of the suspension unit so invisible piston
valving does not become an authoring surface. Larger screen-space selection
handles, wheel-station focus, anchor snapping, chassis x-ray, and mirrored axle
editing solve the small-part usability problem without enlarging collision
geometry or changing physical derivation.

Keep kart assembly and component engineering as separate systems. Required
Phase 3 assembly selects, positions, attaches, mirrors, and validates immutable
approved component versions. Ship at least one freely available sealed default
in every required functional category, including one battery and one motor. Add
a second component only where the current solver supports a legible
assembly-level tradeoff rather than a strict upgrade or progression tier. A
future component-engineering editor may author new reusable component
definitions and their internal primitive/material construction, but it is a
separately planned later phase rather than a prerequisite for official or
community kart assembly.

The accepted Phase 3 manifest contains one battery,
receiver/speed-controller, motor, steering module, and combined braking system,
plus two transmissions, two suspension units, and two wheel/tire assemblies.
Chassis, bodywork, and structural construction remain authored primitives and
materials rather than sealed functional-component categories.

Do not attach progression tiers to the complete components in the kart
assembly catalog. A later component-engineering phase may unlock internal
component parts. An engineered component's required tier then derives from the
highest-tier part it contains and is never an editable component or kart
attribute.

Exact steering geometry is secondary to coherent contact directions and
visible wheel angles. Add Ackermann-style inner/outer angle differences only
if they materially improve the result.

### Ledges and partial support

Do not collapse partial contact into a single grounded state. A wheel that has
left the platform contributes no suspension or tire force. Remaining support
forces continue at their actual locations while gravity acts through the
center of mass.

This must allow the chassis to tip when the remaining contacts can no longer
support its projected center of mass or when momentum produces sufficient
rotation. The approach direction, chassis orientation, supported-wheel pattern,
linear velocity, and angular velocity should therefore change the fall.

Never apply an upright lock while partially supported or airborne.

### Airborne motion, landing, and recovery

Remove suspension and tire forces independently as wheels lose support. Keep
gravity, linear momentum, angular momentum, aerodynamic effects if any, and
ordinary collision response active.

Landing should be absorbed and damped through suspension and rigid-body
contacts. Do not teleport the chassis to the road or snap it upright. Protect
the numerical simulation with bounded suspension travel, bump response, and
proportional substepping rather than by erasing impact velocity.

Do not cap calculated spring, damper, and bump force with an unrelated authored
per-wheel load. Such a cap deletes support during the hardest impacts and makes
bottoming more likely. Finite travel bounds position-derived forces; if a
future numerical safety bound is required, derive and own it as shared solver
policy rather than kart construction.

Do not apply a target-seeking airborne pitch moment to conceal an incoherent
default construction. Ramp attitude must emerge from wheel support timing,
suspension forces, mass distribution, inertia, and the launch surface. The
accepted miniature RC baseline uses an 812.5 N/m effective wheel rate so the
chassis follows the ramp and releases with bounded angular velocity; once
unsupported, no hidden controller torque aims it at a preferred attitude. The
120 Hz physics baseline preserves
approximately the former samples per scaled motion event.

If a future build adds a physical aerodynamic surface, spinning-wheel angular
momentum, or explicit player air control, derive and observe that effect
separately. It must not erase the launch state or incoming collision impulse.

Recovery is a separate policy. Automatic recovery may run only after a
documented stuck or invalid-state threshold. A deliberate player reset may act
immediately, but its destination, orientation, and velocity-clearing behavior
must be explicit and verified.

Distinguish checkpoint recovery from manual self-righting. When an inverted
kart is resting on or immediately above a valid driving surface, a deliberate
recovery request should apply a short, bounded physical roll-and-lift impulse
at the current location. It must not teleport the chassis, write an upright
orientation, discard yaw or momentum, enter a checkpoint-recovery lifecycle,
or become a general airborne-control system. Require clear inversion and nearby
support, rate-limit repeated impulses, and let rigid-body contacts complete the
roll. If those conditions are absent, the established checkpoint-recovery
policy remains authoritative.

Manual righting is a gameplay recovery service rather than authored vehicle
performance. Shared policy specifies a 180-degree recovery over a
kart-length-relative clearance hop (0.08 m for the current reference), a small
shared contact-loss allowance, a
120-degree inversion threshold, posture-based angled-contact scaling,
nearby-support eligibility, and a 450 ms cooldown. At runtime, derive angular
impulse from the kart's moment of inertia about the selected local righting
axis, and derive lift impulse from kart mass, world gravity, and the clearance
target. A bounded righting-only landing window derives target and capture
impulses from the same local inertia, then releases after the first upright
four-wheel contact. A heavier or higher-inertia assembly
therefore receives larger impulses but approximately the same recovery motion;
none of these values belongs to a kart or component definition.

The same semantic request may come from keyboard, controller, an explicit touch
control, or a deliberate low-movement tap that actually hits the inverted kart
on coarse-pointer devices. Gesture recognition and scene picking must only
request the action; the fixed-step physics boundary decides whether righting is
currently valid and applies it once.

### Fixed-step simulation

Advance gameplay physics with a fixed timestep, currently 120 Hz for the
miniature RC scale.
Accumulate render time, execute the required fixed steps, cap catch-up work to
avoid a spiral after long frames, and interpolate presentation where necessary.

Use proportional whole-world or targeted substeps when suspension stiffness,
high speeds, contacts, or low-speed tire behavior require more resolution.
Substeps are a stability and accuracy tool, not a substitute for well-scaled
mass, inertia, force, and suspension parameters.

### Low-speed behavior

Slip ratios and lateral-slip calculations become poorly conditioned near zero
speed. Blend into an explicit low-speed settling model or bounded contact-plane
velocity constraint so the kart can stop smoothly and remain at rest.

The current transitional controller blends the rolling-speed cornering-force
request into a shared 0.12-second lateral-velocity settling target below its
fixed 2 m/s reference. This numerical policy replaces two former per-kart
low-speed stiffness controls; it is not authored construction or tire grip.

Grounded chassis settling is a separate shared solver policy. It may activate
only with every wheel supported, no driving input, planar speed below 0.3 m/s,
vertical speed below 0.2 m/s, and angular speed below 1 rad/s. It targets the
same 1/12-second angular-settling response for every kart. The solver converts
that desired angular-velocity change into a local torque impulse through each
kart's derived inertia tensor, so higher inertia receives proportionally more
impulse without becoming a hidden handling advantage. These eligibility and
timing values are not kart construction or creator tuning.

The low-speed regime must release immediately when drive intent or an external
impact requires motion. Do not disguise the problem with large global linear or
angular damping, because that also destroys airborne and collision behavior.

### Arcade assists

First establish stable unassisted dynamics. Then introduce only the assists the
target feel needs, such as:

- speed-sensitive steering,
- input smoothing with asymmetric rise and release rates,
- traction shaping,
- anti-roll response based on left/right suspension load,
- bounded yaw stabilization tied to grounded state and driver intent, and
- modest airborne control.

Assists must not directly lock orientation, force the chassis onto a path,
overwrite collision impulses, or create support where no wheel has contact.

## Development Controls and Observability

Keep development values in coherent owner-specific contracts with metres,
kilograms, seconds, newtons, and radians where applicable. Compute sensible
starting values from mass, gravity, geometry, and static wheel load when
possible.

The production Kart Dynamics Inspector is read-only. Its flat diagnostic view
must declare every value's authoritative owner/classification and project the
same narrow typed contracts consumed by the simulation; runtime subsystems must
not receive that view as a universal tuning source. Give unfamiliar terms
concise contextual explanations that work with pointer hover, keyboard focus,
and touch without relying on browser `title` text. Help content should be
dismissible, hoverable, persistent while engaged, and programmatically
associated with its output.

Controlled non-production fixtures may mutate bounded development inputs
through the scene-test adapter to isolate construction, derivation, environment,
or policy behavior. Those mutations must reject invalid/coupled values, remain
absent from production, and never become browser storage, account data,
telemetry, hidden profile state, or a player-facing override. Player assembly
changes construction and triggers derivation; it cannot write diagnostic
numbers directly.

Development telemetry should expose:

- fixed-step count and dropped catch-up time,
- center of mass and chassis axes,
- support query and contact result per wheel,
- suspension compression, velocity, and load,
- longitudinal and lateral point velocity or slip,
- requested and clamped tire forces,
- grounded, partial-support, and airborne state,
- linear and angular velocity, and
- ramp support transitions and the resulting unsupported pitch trajectory.

Visual and numeric telemetry is part of the implementation standard because it
makes tuning causal and regressions diagnosable.

## Failure Modes

Reject implementations that rely on:

- a center-point grounded check,
- direct transform movement for normal driving,
- constant upright torque or orientation locking,
- applying all drive and grip forces at the chassis center,
- unlimited independent acceleration, braking, and lateral forces,
- tire grip while unsupported or at zero load,
- frame-rate-dependent forces or smoothing,
- large global damping used to conceal instability,
- landing or collision code that overwrites momentum, or
- undocumented magic parameters that affect several behaviors at once.

## Validation

An implementation is not accepted until repeatable tests and user-facing QA
cover the following behaviors:

1. Comparable outcomes at 30, 60, and 120 Hz render cadences.
2. Stable static equilibrium and predictable low-speed stopping.
3. Repeatable acceleration, braking, reverse, top-speed, and constant-radius
   steering results within agreed tolerances.
4. Progressive and recoverable grip loss.
5. Observable longitudinal and lateral weight transfer.
6. Different, credible ledge outcomes for different supported wheels, approach
   directions, chassis orientations, and momentum.
7. Natural ramp launch, airborne rotation, landing, upside-down, and reset
   behavior without upright snapping or unexplained angular damping.
8. No support over empty space, suspension explosions, or unacceptable
   tunneling in the agreed test course and speed envelope.
9. Development telemetry sufficient to explain every failed scenario above.
10. Acceptable performance on the demo's supported mobile target.

Agree numerical tolerances during tool mapping and implementation, once the
engine's stepping and query behavior have been measured. Do not weaken a
behavioral requirement merely because a chosen API makes it inconvenient.

## Non-Goals

The current kart-physics task does not require:

- physical wheel rigid bodies or suspension joints,
- a detailed engine, clutch, gearbox, or differential,
- Pacejka-level tire simulation, temperature, pressure, or wear,
- collision-response mastery beyond the contacts needed to exercise the kart,
- chase-camera mastery, or
- kart damage and joint breakage.

Those systems may build on this standard without being folded into it.

## Sources

- [NVIDIA PhysX Vehicle SDK: mechanical model, suspension, tire loads, combined
  grip, low-speed handling, and tuning](https://nvidia-omniverse.github.io/PhysX/physx/5.1.0/docs/Vehicles.html)
- [NVIDIA PhysX rigid-body dynamics: mass properties, forces, torque, gravity,
  velocity, and contacts](https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/RigidBodyDynamics.html)
- [Box2D documentation: fixed timesteps and substeps](https://box2d.org/documentation/hello.html)
- [Criterion Games, Vehicle Feel Masterclass: simulation foundations, assists,
  and camera](https://www.gdcvault.com/play/1025295/Vehicle-Feel-Masterclass-Balancing-Arcade)
- [Activision, Supercharged Vehicle Physics in Skylanders: combining physical
  and simplified systems with designer-facing parameters](https://media.gdcvault.com/gdc2016/Presentations/Donnelly_Patrick_Supercharged%20Vehicle%20Physics.pdf)
- [Rocket League Crash Course: player-controlled orientation and recovery onto
  the wheels](https://www.epicgames.com/help/c-202300000001622/c-202300000001682/rocket-league-a202300000010022)
- [MIT OpenCourseWare road-vehicle traction exercise: axle load, available
  traction, and understeer/oversteer balance](https://ocw.mit.edu/courses/16-682-technology-in-transportation-spring-2011/a224aa6d65b2788481794038389a69bf_MIT16_682S11_soln2.pdf)

## Open Questions

- Which support-query shape and collision filters give the best stability and
  performance in the selected browser physics stack?
- Which fixed-step and substep combination meets both behavior and mobile
  performance requirements?
- How much anti-roll, yaw stabilization, and air control does the accepted
  Titan Racers feel actually need?
- Which numerical tolerances should become automated regression gates after
  the first measured implementation?
