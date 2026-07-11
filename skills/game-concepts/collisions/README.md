# Vehicle Collisions

**Maturity:** Validated. The feature lead accepted this engine-independent
standard on 2026-07-10, then accepted the implemented collision, ramp, wheel,
suspension, and high-speed response after repeatable automated and hands-on
verification.

## Purpose and Scope

This node defines the gold-standard collision behavior for Titan Racers. Read
it before changing kart collision shapes, course collision geometry, contact
materials, impact response, collision assists, snag prevention, continuous
collision detection, or collision telemetry.

It deliberately does not prescribe an engine API. Tool-specific implementation
guidance belongs under [`../../tools/`](../../tools/README.md), while the actual
shipped data flow and source ownership belong under
[`../../project-systems/`](../../project-systems/README.md) after the
implementation has been accepted.

## Standard

Build forgiving RC-style collisions from clean gameplay geometry and coherent
rigid-body contact response. Preserve the physics solver as the source of truth,
then add only narrow, explicit assists where measured behavior still fails the
target feel.

The kart must remain a credible physical object. A collision may remove energy,
redirect motion, and create spin, but it must not invisibly teleport the kart,
snap its orientation, erase all momentum, or manufacture a desired pose.

## Desired Outcome

Crashing should be consequential without ending the fun. Players should be
able to read an impact from the kart's speed, approach angle, contact point,
collider shape, and surface. They should usually remain in control or recover
quickly enough to continue the race.

In particular:

- shallow glancing impacts should preserve most motion along the surface while
  scrubbing some speed and removing wall-directed motion;
- direct impacts should slow the kart substantially and may produce a modest
  rebound, but should not feel like a pinball bumper;
- off-center impacts should create proportionate yaw, roll, or pitch through
  the real contact point;
- corners, seams, and decorative details should not snag or stop a kart whose
  visible silhouette ought to slide past;
- ramps should launch and receive the kart through their intended surface,
  without false wall contacts at the base, crest, or side; and
- the kart should not tunnel through supported barriers or obstacles anywhere
  inside the agreed speed and geometry envelope.

## Core Principles

1. **One physical truth.** The authoritative dynamic body, its collision
   shapes, and the contact solver determine ordinary impact motion.
2. **Geometry is behavior.** Gameplay collision shapes are deliberately
   authored controls, not automatic copies of every visible detail.
3. **Contacts preserve causality.** Normal, contact point, relative velocity,
   mass properties, and material response explain the resulting translation
   and rotation.
4. **Glancing motion survives.** Collision response removes or redirects
   surface-normal motion without arbitrarily destroying useful tangential
   motion.
5. **Energy loss is deliberate.** Restitution, friction, and any additional
   response are tuned to avoid both sticky dead stops and pinball bounce.
6. **No phantom features.** Collider seams, internal edges, excessive contact
   margins, and speculative contacts must not create invisible bumps or walls.
7. **Tunneling protection is proportional.** Use geometry thickness, fixed-step
   resolution, sweeps, substeps, or continuous collision detection according to
   measured risk and cost rather than enabling every mechanism indiscriminately.
8. **Assists are last and visible.** An arcade assist is narrowly classified,
   bounded, independently tunable, observable, and disableable for diagnosis.
9. **Repeatability precedes tuning.** Collision scenarios run from controlled
   poses and velocities on the accepted fixed simulation step.

## Recommended Model

### Gameplay collision geometry

Represent the kart with a small number of convex primitives or convex parts
that preserve its gameplay silhouette, mass center, ground clearance, and
important impact lever arms. Prefer a continuous outer envelope over exposed
decorative details that can hook walls or obstacles.

Represent barriers, obstacles, ramps, and drivable surfaces with the simplest
static shapes that preserve their intended gameplay silhouette. Prefer
primitives, convex compounds, and deliberately authored continuous surfaces.
Use triangle meshes only when the course shape genuinely requires them.

Collider transitions that are visually and physically intended to be smooth
must produce smooth contact normals. Remove overlaps, gaps, coplanar seams,
degenerate triangles, unwanted internal edges, thin slivers, and abrupt hidden
steps. Bevel or round exposed gameplay corners when a perfectly sharp corner
would create snagging or an excessively punitive response.

Collision thickness is part of the authored envelope. Static barriers and
floors must be thick enough for the maximum expected per-step motion while
remaining visually honest. Thickness alone is not a complete high-speed
solution, because any finite thickness can still be crossed at sufficient
speed.

### Contact response

Let the rigid-body solver establish non-penetration and ordinary contact
impulses. Preserve all six degrees of freedom so a real off-center contact can
create yaw, pitch, or roll.

Reason about an impact by splitting relative contact velocity into:

- the component along the contact normal, which determines approach severity
  and non-penetration response; and
- the component in the contact plane, which determines sliding and frictional
  speed loss.

Use low, nonzero restitution only when it improves readability and recovery.
Suppress restitution for low-speed resting contacts so the kart does not
jitter or repeatedly bounce. Contact friction should permit a readable slide
along walls and obstacles; it must not substitute for the grounded tire model
or make a shallow glancing impact stick.

Do not immediately overwrite the solver result. Evaluate the unassisted
response first, including its interaction with tire forces on the next fixed
step. Tire response must not erase the collision impulse or repeatedly drive a
kart into a barrier in a way that creates chatter or snagging.

### Corners, obstacles, and ramps

Test corners as their own collision class. A convex outside corner may rotate
the kart when struck off-center, while a concave inside corner must not trap it
between conflicting normals without a reasonable escape. Geometry and contact
friction should solve these cases before a special response is considered.

Obstacles should respond according to their shape and the actual hit location.
A centered strike should remain mostly translational. An offset strike should
produce proportionate rotation rather than a canned spin.

Ramp collision geometry must align with the intended driving plane, have a
clean approach and departure, and preserve ordinary airborne momentum. Avoid a
separate vertical lip at the base or crest unless that lip is an intentional
obstacle.

### Continuous collision protection

Start with the accepted fixed timestep, honest collider thickness, and simple
convex shapes. Measure the fastest supported kart motion per physics step
against the thinnest required obstacle and the kart's smallest relevant
collision dimension.

Add continuous collision protection when repeatable tests show that discrete
contacts can miss a required collision. Select the narrowest mechanism that
meets the envelope:

- a geometry or thickness correction when the authored collider is deficient;
- a shape sweep or time-of-impact query for a constrained special case;
- targeted substeps when the complete contact response needs more temporal
  resolution; or
- continuous collision detection on the fast dynamic body when the engine's
  implementation and cost are acceptable.

Validate both missed collisions and false positives. Speculative contacts can
create ghost collisions, while sweep-based approaches can simplify or omit
rotation and add cost. Continuous collision detection must not introduce
sticking, premature impacts, lost time, unstable restitution, or unacceptable
mobile overhead.

### Arcade assists

Add an assist only after geometry, material response, mass properties, fixed
stepping, and solver behavior have been measured and corrected. A justified
assist may shape a clearly classified case such as an overly terminal head-on
impact or persistent low-angle wall snag.

An assist must:

- use observable criteria such as approach speed, contact normal, incidence
  angle, contact point, grounded state, and pre/post-solve motion;
- have an explicit priority when more than one rule could match;
- preserve contact causality and the solver's non-penetration result;
- add a bounded impulse or bounded correction rather than assigning a complete
  replacement velocity or pose;
- avoid firing continuously during resting contact; and
- be independently logged, tuned, disabled, and covered by tests.

The default is no assist. Complexity must be earned by a repeatable player-facing
failure that simpler corrections cannot solve.

## Tuning and Observability

Keep collision tuning in coherent, designer-facing groups with stable units.
Useful concepts include:

- contact friction and restitution by gameplay material;
- low-speed restitution threshold;
- collision margins or contact-processing distance;
- maximum supported speed and minimum required collider thickness;
- continuous-collision motion threshold and swept volume;
- impact severity bands derived from normal approach speed or impulse; and
- any assist's incidence, severity, duration, and response limits.

Development telemetry should expose at least:

- contacted entity and gameplay material;
- contact point and normal;
- pre-solve or best-available approach speed;
- normal and tangential contact velocity;
- contact impulse or a documented severity proxy;
- kart linear and angular velocity before and after the step;
- grounded, partial-support, and airborne state;
- whether continuous collision handling participated; and
- which collision assist, if any, activated and why.

Debug rendering should make kart and course collision shapes, contact points,
normals, and continuous-collision sweeps or envelopes inspectable.

## Failure Modes

Reject implementations that rely on:

- direct transform correction during ordinary contacts;
- complete post-impact linear or angular velocity replacement;
- orientation snapping or hidden guide rails;
- high global damping used to conceal poor collision response;
- high restitution used to eject the kart from penetration;
- chassis friction tuned so high that glancing contacts stick;
- visible meshes copied blindly into complex collision meshes;
- overlapping primitives, collider gaps, or internal triangle edges that create
  phantom normals;
- thin one-sided surfaces outside their reliable speed envelope;
- continuous collision detection enabled everywhere without measurements;
- speculative contacts accepted despite reproducible ghost collisions; or
- layered response rules without explicit criteria, priorities, bounds, and
  telemetry.

## Validation

An implementation is not accepted until repeatable tests and user-facing QA
cover the following behaviors across representative low, medium, and maximum
supported speeds:

1. Shallow and steep glancing strikes preserve useful tangential motion without
   penetration, grabbing, chatter, or implausible acceleration.
2. Centered barrier impacts substantially reduce normal motion and produce no
   more than the accepted modest rebound.
3. Off-center barrier and obstacle impacts create directional, proportionate
   spin from the contact point without canned rotation.
4. Convex outside corners and concave inside corners remain readable and do not
   snag or trap the kart unreasonably.
5. Repeated sliding across intended continuous surfaces and collider seams does
   not produce phantom bumps or edge catches.
6. Ramp bases, crests, sides, launches, and landings produce no false wall
   contacts and preserve coherent momentum.
7. The kart can steer and drive away after ordinary impacts without tire forces
   erasing the hit or forcing persistent contact.
8. The kart does not tunnel through the thinnest required barrier or obstacle
   at the maximum supported linear and angular speed envelope.
9. Continuous collision protection introduces no accepted false hits,
   sticking, unstable rebound, or unacceptable performance cost.
10. Comparable controlled scenarios at 30, 60, and 120 Hz render cadences yield
    the same qualitative result and remain within agreed numerical tolerances.
11. Every collision assist is tested both enabled and disabled, with evidence
    that it fixes a specific failure without distorting unrelated contacts.
12. Collision telemetry and debug rendering are sufficient to explain any
    failed scenario above.
13. Hands-on desktop and supported mobile-target QA confirms that collisions
    are consequential, forgiving, legible, and quick to recover from.

Agree exact speeds, incidence angles, retained-speed ranges, rebound limits,
spin ranges, repetition counts, and performance budgets during tool mapping and
implementation after the selected engine has been measured. Do not weaken a
behavioral requirement merely because an API makes it inconvenient.

## Non-Goals

Collision Mastery does not require:

- kart damage, detachable parts, or joint breakage;
- physical wheel rigid bodies;
- full production course art or final course collision meshes;
- kart-to-kart multiplayer contact policy;
- a general-purpose material system for every future surface;
- chase-camera impact response;
- advanced tire simulation; or
- recovery-system expansion beyond verifying that existing deliberate reset
  and invalid-fall recovery still work after collisions.

## Sources

- [NVIDIA PhysX rigid-body collision: shapes, materials, contacts, and
  filtering](https://nvidia-omniverse.github.io/PhysX/physx/5.1.0/docs/RigidBodyCollision.html)
- [NVIDIA PhysX advanced collision detection: contact offsets, persistent
  manifolds, CCD, speculative contacts, and performance](https://nvidia-omniverse.github.io/PhysX/physx/5.1.1/docs/AdvancedCollisionDetection.html)
- [NVIDIA PhysX rigid-body dynamics: contact and friction
  solving](https://nvidia-omniverse.github.io/PhysX/physx/5.3.0/docs/RigidBodyDynamics.html)
- [NVIDIA PhysX geometry queries: raycasts, sweeps, overlaps, and penetration
  depth](https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/GeometryQueries.html)
- [Box2D simulation documentation: fixed stepping, continuous collision,
  restitution thresholds, contact impulses, and hit
  events](https://box2d.org/documentation/md_simulation.html)
- [Erin Catto, Continuous Collision: tunneling, speculative contacts,
  time-of-impact methods, and tradeoffs](https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf)
- [Bullet `btInternalEdgeUtility`: triangle-edge normal
  correction](https://pybullet.org/Bullet/BulletFull/btInternalEdgeUtility_8h.html)
- [Bullet `btCollisionObject`: friction, restitution, contact-processing, and
  CCD controls](https://pybullet.org/Bullet/BulletFull/classbtCollisionObject.html)
- [Vicarious Visions, Supercharged Vehicle Physics: layered, data-driven,
  rule-based vehicle collision response](https://media.gdcvault.com/gdc2016/Presentations/Donnelly_Patrick_Supercharged%20Vehicle%20Physics.pdf)

## Open Questions

- Which simple compound collision envelope gives the current kart the best
  balance of silhouette accuracy, ground clearance, ramp behavior, and smooth
  wall contact?
- Which course primitives, bevels, or authored seams are required for the PR 2B
  collision test course?
- How does the selected Ammo build combine friction and restitution for the
  kart's compound children and static course shapes?
- Which collision events or direct Ammo manifold data can provide reliable
  approach speed, impulse, point, and normal telemetry in PlayCanvas?
- What continuous-collision threshold and swept-sphere radius cover the maximum
  supported kart speed without ghost contacts or excessive cost?
- Does accepted behavior require any arcade collision assist after geometry,
  materials, CCD, and tire-force interaction are tuned?
