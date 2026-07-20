# Titan Racers Demo v1 Implementation Plan

## Purpose

Build a browser-playable Titan Racers demo that proves the core fantasy:

> Race tiny buildable karts through forbidden service routes inside humanity's last Titan colony.

The demo is complete only when solo racing, primitive-authored official and
community kart designs, ghosts, leaderboard-ready results, immediate
community-kart and community-course publishing and discovery, private
multiplayer, and controller support are all working.

## Alignment Summary

- Start with racing feel. The first playable center is a fun two-lap RC-style race in the Agricultural Zone.
- Private multiplayer is required for Demo v1 completion, but solo driving comes first so the handling can be tuned.
- Admin kart construction and publication establish the bounded primitive
  pipeline before it opens to every logged-in player after Phase 5.
- Use "assembler" as a player capability, not a separate creator role.
- Kart behavior must come from validated construction and a transparent,
  versioned derivation model. Do not hide editor, derivation, or physics defects
  behind manual stat overrides.
- Kart cards should be practical and machine-focused, not lore-heavy.
- Use the existing Titan Racers site aesthetic and typography before inventing a new system.
- Use a Next/React-style app shell with a tiny engine spike before fully committing to the game runtime.
- PlayCanvas is the preferred runtime candidate, but the spike can challenge that if another path is clearly better.
- Use Postgres locally and Neon when hosted.
- Defer external kart-model uploads and their object-storage boundary until
  after Demo v1.
- Use Better Auth with Postgres-backed sessions and application-owned identities.
- Keep application identity provider-neutral so connected EOA login can be added
  through SIWE and embedded-wallet infrastructure can be integrated later without
  replacing Titan Racers user IDs.
- Target the playable app as a separate experience from the marketing site, likely `play.titanracers.com`.

## Product Scope

### Required For Demo v1

- Mobile-friendly playable web app.
- Fast guest entry into racing.
- One official playable track: Agricultural Zone Service Circuit.
- Player-authored courses that logged-in players can publish immediately from
  the bounded course editor.
- Public community-course discovery with reversible player thumbs-ups, admin
  featuring, and safety unpublishing.
- Two-lap solo time trial.
- Three playable official kart designs from the primitive authoring and
  publication pipeline.
- Kart selection with:
  - name,
  - assembler credit,
  - visual identity,
  - stat bars,
  - short practical descriptor.
- Distinct kart handling profiles.
- Keyboard controls.
- Mobile touch controls.
- Gamepad/controller controls.
- Fast reset/recover control.
- Developer ghost.
- Player-best ghost.
- Result screen for every race.
- Login-gated solo leaderboard submission.
- Private 2-4 player multiplayer rooms.
- Join-by-link guest multiplayer.
- Admin-gated primitive kart create/edit/publish workflow.
- Player-owned community kart creation, immediate publication, discovery, and
  safety unpublishing after player-facing identity is available.
- Agricultural Zone best-time medals that establish progression tiers for a
  later component-engineering system; complete kart-assembly components are
  not direct unlock rewards.
- Basic analytics for learning whether the demo is fun.

### Explicitly Not Required For Demo v1

- External kart-model or custom-asset uploads.
- Full creator marketplace.
- Patenting or licensing.
- On-chain gameplay.
- Token rewards.
- Deep economy.
- Global ranked multiplayer.
- Robust anti-cheat.
- Full production-quality art.
- Real-world kit export pipeline.
- Complex damage beyond the focused first-pass authored-joint breakage model.
- Fuel or battery simulation.
- Advanced tire physics.
- Player-authored numerical tuning profiles or raw handling controls.
- Overly punishing collisions.

## App And Technical Direction

### App Shell

Use a Next/React-style app shell unless the scaffold phase reveals a strong reason not to. The shell should own:

- mode selection,
- kart selection,
- auth UI,
- admin and player kart-authoring surfaces,
- results,
- leaderboard,
- community-kart authoring, discovery, and safety controls,
- community-course authoring, discovery, ranking, and curation,
- rooms and lobby UI,
- sharing,
- analytics,
- responsive layout.

The playable app should be deployable independently from the marketing site, with `play.titanracers.com` as the expected target shape.

### Game Runtime

Run a tiny engine spike before committing fully.

Evaluate first:

- PlayCanvas, because the concept doc points to it and it fits browser/mobile 3D.

Fallback only if needed:

- Three.js plus supporting physics/game helpers.

The deciding factor is the fastest path to good-feeling mobile/browser RC racing.

### Persistence

Use Postgres for relational data:

- users,
- player profiles,
- player-owned kart heads and immutable revisions,
- official and community kart publications,
- versioned derived kart physics and player-facing stats,
- player-earned progression tiers and, only when the later
  component-engineering system exists, component-part entitlements,
- race sessions,
- race results,
- leaderboard entries,
- player-owned course drafts and immutable published revisions,
- community-course thumbs-ups and admin feature state,
- multiplayer room records where useful.

Use local Postgres for development and Neon for hosted environments.

The backend should expose API surfaces for player, kart, course, course
publication, course discovery, course ranking, race, room, result, and
leaderboard data. Multiplayer also needs a realtime server or realtime-capable
service; exact framework should be chosen during implementation.

### Asset Storage

Demo v1 karts and courses use bounded, validated primitive documents and do not
require player-supplied asset storage. If a later version accepts external
models or larger generated assets, introduce a separately reviewed
S3-compatible storage boundary and keep object metadata in Postgres.

### Auth And Authorization

Guest play must stay frictionless.

Login is required for:

- persistent racer identity,
- leaderboard submission,
- community-kart authoring and publishing,
- community-course authoring, publishing, and thumbs-ups,
- admin controls,

Use Better Auth with Postgres-backed sessions. Begin with one conventional social
login method for protected administration, then add player-facing login methods
when their product flows require them. Guest racing must not require an auth
session.

Titan Racers application user IDs remain canonical. Authentication-provider
accounts, connected EOAs, and any future embedded-wallet provider IDs attach to
the application user rather than replacing that identity. Add connected EOA
login and explicit account linking through SIWE with the Phase 5 player identity
and leaderboard work. Embedded wallets and on-chain transactions remain deferred
until an accepted product requirement justifies the additional provider,
security, and operational boundaries.

Store application roles in Postgres and enforce them close to protected data and
mutation boundaries. Client-side visibility checks improve the experience but
are never the authoritative permission check. Bootstrap the first admin through
a documented database operation requiring database credentials; do not expose a
public role-promotion endpoint or use a deployment environment allowlist as the
durable authorization source.

## Roles And Permissions

Use a simple player-centered model.

### Guest

- Can race casually.
- Can browse and race published official and community courses.
- Can join private rooms.
- Can see local race results.
- Cannot submit to global leaderboard.
- Cannot persist or publish kart designs.

### Player

- Logged-in identity.
- Can save display name/history.
- Can submit eligible solo leaderboard results.
- Can create, edit, publish, revise, and unpublish their own bounded community
  kart designs after the Community Karts phase lands.
- Can create and edit their own private course drafts.
- Can immediately publish validated revisions of their own courses.
- Can unpublish their own courses.
- Can give or remove one thumbs-up per published community course.

### Admin

- Trusted launch operator account with a Postgres-backed admin role.
- Multiple admins are allowed.
- Can access protected course/editor tooling.
- Can edit track layout and test-scene objects.
- Can create, revise, publish, and unpublish official kart designs through the
  same bounded authoring system later used by players.
- Can feature or unfeature published community karts.
- Can safety-unpublish broken, malicious, or inappropriate community karts
  without deleting their revision history.
- Can feature or unfeature published community courses.
- Can safety-unpublish broken, malicious, or inappropriate community courses
  without deleting their revision history.
- Can inspect derived kart physics and player-facing stats, but cannot override
  them.

## Kart Design And Publication System

The demo should prove that karts are machines, not skins.

Karts are versioned, validated documents assembled from a bounded catalog of
visual primitives and functional machine parts. Reuse the course editor's
proven selection, gizmo, snapping, history, responsive inspector, and camera
patterns where they generalize cleanly, but keep kart and course documents and
runtime semantics separate.

Minimum official-kart workflow:

1. Admin creates a kart draft from bounded primitives and functional parts.
2. System validates construction, dimensions, wheel layout, complexity, and
   functional requirements.
3. A versioned algorithm derives mass, center of mass, inertia, wheel geometry,
   runtime physics, and player-facing stats.
4. Admin inspects the construction and derived behavior without numerical
   overrides.
5. Admin tests the kart in controlled fixtures and a complete race.
6. Admin publishes or unpublishes an immutable kart revision.
7. Published official karts appear in player-facing kart selection.

After player-facing identity lands, every logged-in player uses the same
document, derivation, editor, and immutable-revision pipeline for community
karts. Player-facing authoring never exposes raw runtime tuning values.

Phase 3 approved components use stable IDs but have no progression unlock
requirements. A later component-engineering system may define tiered internal
parts. An engineered component's required tier must then derive automatically
from the highest-tier part used in its construction; it is not an editable
component or kart statistic. Do not design that part catalog, entitlement
model, or authorization surface inside kart assembly.

Derivation must be deterministic, bounded, explainable, and versioned. A
published revision records both its authored document and resolved derived
snapshot so later formula changes cannot silently change historical race
identity. If a reasonable construction behaves incorrectly, fix the editor,
part definitions, derivation model, or underlying physics rather than adding an
exception or manual override.

## Kart Roster

Start with three published karts:

- Balanced build: stable default.
- Speed build: higher top speed, harder to control.
- Handling build: tighter turns, lower top speed.

Each should have distinct handling and visual identity. Avoid long flavor text.

## Controls

Required:

- keyboard,
- mobile touch,
- gamepad/controller,
- reset/recover.

Gamepad support moves early in the build so testing can happen from a TV/couch setup. It can begin rough and become polished later.

Initial controller mapping:

- left stick: steer in-race and move through menus vertically,
- D-pad: digital steering in-race and menu navigation,
- right trigger: accelerate,
- left trigger: brake/reverse,
- A button: reset/recover in-race and confirm in menus,
- B button: back in menus,
- menu/start: pause/resume.

Optional:

- boost, only if it improves fun quickly.

## Visual Direction

Match the existing Titan Racers site first:

- black/near-black base,
- ice text,
- orange and hazard yellow signals,
- steel/blue technical accents where useful,
- Arial/Helvetica-style sans,
- Courier-style mono labels,
- bold uppercase headings,
- generous tracking on operational labels,
- sharp industrial borders,
- restrained panels,
- real habitat/kart imagery as reference.

The game HUD should feel like a racing operations interface, not a lore panel or generic neon arcade skin.

The primary multiplayer-friendly CTA should be "Race Friends" or equivalent language with that emotional shape.

## Official Track Direction

One official authored track:

> Agricultural Zone Service Circuit

Route beats:

1. Starting service lane.
2. Tight hydroponic rows.
3. Narrow irrigation tunnel.
4. Glass canopy or habitat vista.
5. Maintenance ramp/drop.
6. Return lane through floor-marked service infrastructure.

The art goal is strong scale language over polish: oversized crop trays, pipes, vents, doors, maintenance rails, ramps, catwalks, and glimpses of the larger O'Neill Cylinder beyond the route.

Race length target: two laps should usually land around 90 seconds to 2.5 minutes total.

Handling target: fast RC-style arcade racing with quick acceleration, tight steering, slight controlled slip/drift, forgiving wall contact, fast reset, and a strong retry loop. It should be easy to finish and hard to master.

## Results And Leaderboards

Every race ends with a result screen.

Show:

- total time,
- lap times,
- kart used,
- placement for multiplayer,
- replay flow,
- share affordance,
- login prompt when leaderboard-eligible.

Solo leaderboard:

- global,
- login required to submit,
- guests can race and see local result,
- official karts are leaderboard-eligible for Demo v1; community karts begin as
  casual-race entries until their derived balance is validated,
- multiplayer is room-only for v1.

## Community Kart Publishing

After player-facing identity is available, any logged-in player can use the
bounded primitive kart editor to create a private draft and immediately publish
a validated immutable revision. Guests can browse and race published community
karts, but persistent authorship requires a player identity.

The public catalog clearly distinguishes official and community karts. There is
no pre-publication moderation queue and no raw numerical tuning surface. Safety
boundaries include server-side ownership and authorization, bounded text and
part counts, strict kart-document and structural validation, deterministic
server-owned stat derivation, publish-rate limiting, and admin safety
unpublishing without deleting revision history or attribution.

Community Karts also introduces a versioned structural-joint contract and the
first forgiving environment-impact breakage model. Joint strength is derived
from bounded authored connections rather than arbitrary creator-entered damage
numbers. External models, custom assets, marketplace behavior, collaborative
editing, and unrestricted competitive eligibility remain outside this release.

## Community Course Publishing

Community publishing is immediate rather than approval-gated. Any logged-in
player can use the bounded primitive course editor to create a private draft and
publish a validated immutable revision. Guests can browse and race published
courses, but persistent authorship and ranking actions require a player
identity.

The public catalog distinguishes:

- the official Agricultural Zone Service Circuit,
- admin-featured community courses,
- popular community courses ranked by reversible thumbs-ups,
- newly published community courses.

Each logged-in player can give at most one reversible thumbs-up per published
course. Do not use downvotes or multi-value star ratings for the first version.
Admin featuring is an explicit curation signal and must not alter the community
thumbs-up count or ranking data.

There is no pre-publication moderation queue. Safety controls still include
server-side ownership and authorization, bounded player-authored text,
course-document validation, publish-rate limiting, and an admin safety-unpublish
operation. Unpublishing hides a course from public discovery and ordinary guest
play without deleting its authored drafts, immutable publication history,
attribution, or prior administrative actions.

Publishing a newer revision must not mutate an earlier published revision or
silently change the course revision associated with historical race data.
Custom course asset uploads, player-to-player collaborative editing, comments,
downvotes, and a general-purpose moderation queue remain outside the first
community-course release.

## Multiplayer

Private multiplayer is required for Demo v1 completion.

Requirements:

- create private room,
- join by link,
- 2-4 players,
- guest joining allowed,
- each player selects a kart,
- kart selection marks ready,
- host starts race,
- countdown start,
- visible opponents,
- synced timer/results,
- race ends when all active players finish or shortly after first finisher,
- replay same room,
- no public matchmaking,
- no ranked multiplayer leaderboard.

Multiplayer collisions require their own reviewed system boundary rather than
being treated as incidental transform synchronization. One authoritative
outcome must account for both karts' mass, relative contact velocity, contact
normal, and angle of attack; apply impulses and damage once; and synchronize
joint damage and detached parts under latency, reordering, disconnects, and
reconciliation. Verification must distinguish low-speed rubbing, glancing
contact, rear-ending, head-on impact, pileups, airborne contact, and concurrent
kart/environment impacts.

## Analytics

Analytics should exist early because the demo is partly a learning instrument.

Track at minimum:

- app opened,
- game loaded,
- mode selected,
- kart selected,
- race started,
- lap completed,
- race completed,
- race restarted,
- multiplayer room created,
- multiplayer room joined,
- multiplayer race started,
- share clicked,
- login started,
- login completed,
- leaderboard submitted,
- community kart published,
- community kart selected,
- community course published,
- community course selected,
- community course thumbs-up added or removed,
- controller detected,
- input type used,
- dropped before race start,
- dropped mid-race.

Key metrics:

- time to first race,
- race start rate,
- race completion rate,
- replay rate,
- multiplayer room join success,
- share click rate,
- login conversion after race,
- community kart publish success,
- community kart play rate,
- community course publish success,
- community course play rate,
- community course thumbs-up rate.

## Implementation Phases

### Phase 0: Plan And Repo Foundation

- [x] Review plan with project owner.
- [x] Create the first approved plan commit.
- [x] Scaffold app once plan is approved.
- [x] Add lint/build/test scripts.
- [x] Bring over Titan Racers visual tokens and typography direction.
- [x] Copy only needed site assets into this repo.

### Phase 1: Tiny Engine Spike

- [x] Test the preferred game runtime.
- [x] Confirm canvas integration in the app shell.
- [x] Confirm mobile rendering path.
- [x] Confirm rough kart movement can be tuned quickly.
- [x] Decide PlayCanvas vs fallback before deeper implementation.

### Phase 2: Driving Prototype With Early Controller Support

Goal: make testing fun quickly.

Deliver Phase 2 through five narrow PRs. Each task inside a bundled PR keeps its
own focused implementation session, acceptance gate, verification evidence, and
conventional commit. Do not move to the next task until the current behavior is
accepted, even when both tasks share a PR.

For each substantial game system, use the repository Skills Tree as a required
knowledge-first workflow before implementation:

1. Research the engine-independent gold standard deeply, favoring primary
   sources and strong practical evidence.
2. Review the proposed standard with the feature lead, then record the accepted
   behavior, failure modes, and validation evidence under
   `skills/game-concepts/`.
3. Research how the approved concept maps onto the selected engine, libraries,
   and platform constraints. Review those choices with the feature lead, then
   record the accepted APIs, limitations, and working methods under
   `skills/tools/`.
4. Implement and verify the system against both accepted knowledge nodes.
5. After the implementation is accepted, document its actual responsibilities,
   data flow, invariants, source ownership, verification paths, and limitations
   under `skills/project-systems/`.

Apply this workflow independently to kart physics, collisions, chase-camera
behavior, course editing, input, race progression and recovery, and any other
system whose quality depends on substantive game-development knowledge. Do not
write a project-system node speculatively before its implementation has been
validated, and do not present exploratory research as an accepted gold
standard.

#### PR 1: Gameplay Architecture

Establish only the minimum durable seams needed to replace spike behavior
safely. Preserve the accepted visible behavior while separating:

- [x] PlayCanvas application and scene lifecycle,
- [x] data-driven course construction,
- [x] the current kart controller behind a replaceable interface,
- [x] a normalized input contract initially backed by keyboard input,
- [x] chase-camera behavior,
- [x] editor UI state from engine operations,
- [x] deliberate development and test adapters from production behavior.

#### PR 2A: Kart Physics

Treat these as separate tuning and acceptance tasks within one integrated PR:

- [x] fixed-step simulation and dynamic rigid-body kart physics,
- [x] grounded traction, braking, reverse, steering, lateral grip, and weight
      transfer,
- [x] support-aware ledge behavior, airborne rotation, landing, and recovery,

The kart-physics unit is a standalone PR boundary so the accepted fixed-step,
rigid-body, support, tire-force, and recovery behavior can be reviewed without
mixing it with the equally substantial collision and camera systems.

#### PR 2B: Collision Mastery

- [x] collision behavior for barriers, corners, obstacles, ramps, glancing
      impacts, snagging, bounce, spin, and tunneling,

#### PR 2C: Chase-Camera Mastery

- [x] chase-camera behavior driven by actual kart motion, orientation, slip,
      impacts, and airborne state.

After PR 2C is implemented and verified, run the final proportional integration
review for the complete driving-simulation phase before merging its final work
into `main`.

#### PR 3: Protected Course Tooling

Split protected course tooling into three independently reviewable PR-sized
units. Keep PRs 3A and 3B product-UI-neutral; PR 3C is the first new visible
course-authoring experience.

##### PR 3A: Course Data Foundation

- [x] research and approve the engine-independent course-editing standard and
      its PlayCanvas mapping,
- [x] define a versioned, validated, portable course-document contract with
      stable object and checkpoint IDs,
- [x] define a bounded primitive-object catalog with shape-specific dimensions
      and semantic visual/collision defaults that later editor placement can
      instantiate without changing the persisted contract,
- [x] model course objects, transforms, collision shapes, start placement, and
      ordered checkpoints without coupling persisted data to PlayCanvas entity
      instances,
- [x] model bounded course-level ambient and directional lighting, including
      color, intensity, direction, and safe shadow-quality presets, while
      preserving the accepted rough-course presentation,
- [x] construct the accepted rough course from the course document while
      preserving its accepted visible, physics, collision, camera, and driving
      behavior,
- [x] add deterministic import/export serialization, validation, and a
      source-controlled seed course suitable for tests and recovery,
- [x] stop before durable database persistence, authentication, authorization,
      or new editor UI.

##### PR 3B: Identity, Authorization, And Course Persistence

- [x] add the local Postgres and hosted Neon persistence foundation with
      version-controlled migrations,
- [x] add Better Auth with Postgres-backed sessions and one approved
      conventional admin login method,
- [x] store canonical application users, linked provider identities, and
      application roles in Postgres,
- [x] bootstrap the first admin through a documented database operation and
      enforce the admin role at centralized server/data authorization
      boundaries,
- [x] store portable course documents as immutable Postgres JSONB revisions
      with author attribution, schema version, and optimistic concurrency,
- [x] add protected course load/save APIs while keeping the product UI
      unchanged,
- [x] stop before player-facing EOA login, embedded wallets, or the visible
      course editor.

##### PR 3C: Protected Course Editor

- [x] replace the development-only Lite Editor with a protected admin course
      editor and login/access experience,
- [x] provide an add-object palette of approved course presets such as blocks,
      barriers, barrels, ramps, and platforms, backed by the bounded primitive
      course-object contract rather than special engine-only objects,
- [x] establish selection, transform, placement, and deletion behavior for the
      approved editable object types,
- [x] establish start placement and ordered checkpoint authoring,
- [x] visualize the authoritative collision shapes without creating a second
      collision-geometry model,
- [x] expose basic course-level ambient, sun, and optional fill-light controls
      for color, intensity, direction, and bounded shadow quality, with a reset
      to the loaded lighting setup,
- [x] implement command-based undo/redo, revert-to-loaded-draft, dirty-state,
      conflict-safe draft saving, latest-draft recovery, and a secondary
      portable backup download,
- [x] verify desktop and narrow-screen authoring workflows without changing
      ordinary guest racing access.

Complete protected course tooling through three separately QA-reviewed final
slices. First finish private draft persistence and bounded lighting authoring.
Then add an explicit preview/publish boundary: saved drafts remain private,
publishing appends one attributed concurrency-safe event that promotes a
validated saved revision, the editor identifies both draft and published state,
and guest racing reads only the latest publication for its explicitly configured
course ID. Finally remove the
development-only Lite Editor after the protected draft and publishing paths can
replace it without losing required test fixtures. Revision history/restore,
real-time collaboration, and automatic multi-author merging remain later
production-tooling work.

Keep `rough-course` as the permanent editor, physics, collision, camera, and
recovery sandbox with a guarded seed-restore operation that appends an immutable
revision. Author the official Agricultural Zone under the separate stable course
ID `agricultural-zone`; publishing and guest runtime selection must never
conflate the sandbox head with the official live track.

#### PR 4: Rough Race Loop

Complete the rough race loop through three separately reviewed PR-sized slices.
Research significant game concepts through the Skills Tree before implementation,
map the accepted standards to the current browser and PlayCanvas tooling, and
document the verified shipped systems after each slice lands.

##### PR 4A: Unified Player Input

- [x] define one normalized action contract for steering, throttle,
      brake/reverse, reset, and pause,
- [x] unify keyboard, mobile touch, and early gamepad/controller input behind
      device-specific adapters,
- [x] establish device arbitration, analog dead zones, disconnect behavior,
      pointer cancellation, held-input clearing, and pause-safe input handling,
- [x] provide accessible analog touch steering, touch pedals, and deterministic
      adapter tests,
- [x] support controller focus, confirm, back, pause/resume, and exit across
      guest-play mode selection and race overlays without requiring a mouse,
- [x] stop before countdowns, checkpoints, laps, or race timing.

##### PR 4B: Race Lifecycle And Progression

- [x] add explicit loading, ready, countdown, racing, paused, recovering, and
      finished states,
- [x] add ordered checkpoints, laps, deterministic timing, and
      invalid-progression handling,
- [x] add safe checkpoint recovery with route-aligned orientation and linear
      and angular velocity reset,
- [x] stop before the final integrated HUD and full cross-device loop
      acceptance.

##### PR 4C: Integrated Rough Race Loop

- [x] connect unified input to the complete race lifecycle,
- [x] add countdown, player-relevant route feedback, lap, timer, recovery, and
      rough finish presentation without exposing invisible checkpoint counts,
- [x] tune rough-course triggers and recovery placements, with feature-lead QA
      confirming that no geometry changes are required for this slice,
- [x] complete the rough test loop through combined keyboard, touch, and
      controller driving coverage, deterministic traversal, and feature-lead
      cross-device feel QA,
- [x] run PR-level verification and independent review plus a proportional
      integration review across the complete PR 4 race-loop work.

#### PR 5: Telemetry And Runtime Resilience

Complete telemetry and runtime resilience through two separately reviewed
PR-sized slices. Keep collection deliberately small: one summarized gameplay-run
record, a protected operational dashboard, anonymous page analytics, and no raw
input, movement, per-frame, hardware-identity, or player-journey capture.

##### PR 5A: Gameplay Telemetry And Admin Dashboard

- [x] provider-neutral, versioned gameplay-run milestone contract,
- [x] privacy-conscious Postgres gameplay-run summaries using opaque run IDs,
      nullable future server-owned account attribution, and no per-frame data,
- [x] protected read-only admin dashboard for attempts, load/start/finish
      conversion, race timing, input-family use, recovery use, unfinished runs,
      and grouped failures,
- [x] Vercel Web Analytics for anonymous page views without custom gameplay
      funnel duplication,
- [x] focused database, authorization, privacy, browser, and dashboard QA plus
      the PR-level independent-review gate.

##### PR 5B: Runtime Resilience And Phase 2 Closeout

- [x] focus loss, visibility change, resize, input cancellation, lower frame
      rate, loading, and WebGL/context failure behavior,
- [x] summarized runtime-health reporting through the PR 5A gameplay-run
      contract and dashboard,
- [x] integrated Phase 2 verification and independent review.

Phase 2 remains limited to one rough kart and a rough test loop. Primitive kart
authoring, Agricultural Zone visual production, ghosts, leaderboard submission,
and multiplayer remain in their later phases.

#### Phase 2 Feedback Polish

Complete the accepted Phase 2 feedback polish before beginning Phase 3. Keep
each sub-item as a separately QA-accepted conventional commit, and do not move
to the next item until the feature lead has accepted the current behavior.

- [x] greatly reduce ordinary steering sharpness while preserving useful
      low-speed maneuvering,
- [x] make progressive drift available through the physical tire model at all
      times, with braking and a rear-biased handbrake making initiation common
      without enabling a scripted drift mode,
- [x] increase reverse top speed during Phase 2 tuning; Phase 3 later replaces
      the temporary separate reverse controls with the same derived motor force
      and no-load speed used forward,
- [x] replace mobile's horizontal steering-only pad with proportional two-axis
      steering and forward/brake-reverse intent,
- [x] give touch players continuous rear-handbrake intent from forward motion,
      strong steering, and the brake pedal without adding a drift mode,
- [x] distinguish physical in-place manual righting from automatic off-course
      checkpoint recovery, and
- [x] add Shift-modified multi-object editor selection and group translation.

### Phase 3: Kart Dynamics And Admin Kart Builder

Goal: understand and simplify the handling model, then prove through three
official builds that karts are machines rather than skins.

Do not begin the persisted kart format or editor until the tuning-mastery gate
is accepted. Deliver Phase 3 through four independently reviewable PR-sized
units.

#### PR 3A: Kart Dynamics Mastery And Derivation Contract

Phase 3A began with a `KartTuning` contract containing 62 numeric parameters.
Treat that as an audit input, not a target designer-facing API; the in-progress
surface is now 16 after the completed chassis-contact module, removal of four
target-seeking airborne-pitch controls, and replacement of twelve per-kart
smoke controls with one shared presentation policy, plus derivation of
load-aware cornering stiffness from peak contact grip, current wheel load, and
peak-slip angle, plus relocation of the 2 m/s low-speed tire crossover into
shared solver policy and replacement of fixed manual-righting impulses with
mass/inertia-aware shared recovery targets, plus relocation of all four
grounded rest-settling controls into one inertia-aware shared solver policy.
Reduce handling
to the smallest set of independent, understandable physical concepts that
preserves fun, controllability, and physically credible behavior. Consolidate
coupled knobs, derive intermediate values, remove obsolete or misleading
controls, and keep implementation constants out of kart-authored data.

Classify every existing parameter as exactly one of:

- kart-derived physical behavior,
- shared world or controller policy,
- bounded recovery or stability assistance,
- presentation-only response, or
- obsolete/redundant behavior to remove.

Master the handling model interactively, one causal relationship at a time:

1. Introduce one physical relationship and identify its runtime owner.
2. Ask the feature lead to predict a controlled change before running it.
3. Run an A/B fixture that changes only the studied input.
4. Compare observed motion and local diagnostic telemetry with the prediction.
5. Connect the behavior to an authored functional part or geometric property.
6. Fix the model when reasonable physical expectations and runtime behavior
   disagree.
7. Obtain feature-lead acceptance before advancing to the next module.

Cover, in order:

- [x] the complete input-to-wheel-force-to-chassis-motion pipeline,
- [x] mass, center of mass, and inertia,
- [x] wheelbase, track width, wheel radius and width, support points, driven
      wheels, and steered wheels,
- [x] propulsion, speed response, coasting, braking, and reverse,
- [x] replace target-acceleration propulsion with a fixed total motor-force
      capability, symmetric no-load speed falloff, and a fixed equal split
      across configured driven wheels so an unsupported wheel loses its share;
      make four-wheel service braking proportion its bounded request by current
      supported load while the independent handbrake retains its rear-only
      split,
- [x] speed-sensitive steering response and turning geometry,
- [x] set one shared steering-request margin at 45% of the lower grip or
      rollover boundary, add half of the transient tire-slip demand needed to
      build cornering force without double-counting front/rear steady-state
      slip, and give the direction-of-travel trailing axle one shared
      recoverability margin rather than a permanent rear-grip bonus,
- [x] slip angle, lateral stiffness, peak grip, sliding grip, breakaway, and
      front/rear balance,
- [x] combined-slip braking, handbrake behavior, yaw leverage, drift sustain,
      and recovery,
- [x] suspension travel, spring, damping, bump response, load bounds, ride
      height, and bottoming out,
- [x] make finite wheel support use each drivable primitive's authored top/cap
      axis, since Ammo cylinder sweeps can return destabilizing wheel-edge
      normals even on flat ground; measure damper speed along the physical
      strut/body-up axis rather than the collision normal,
- [x] chassis collision shape, friction, restitution, and rigid-body damping,
- [x] airborne pitch behavior, grounded rest settling, and manual righting;
      target-seeking airborne torque is removed, and the default construction
      now uses the RC-scaled equivalent 812.5 N/m effective wheel spring rate
      and a 120 Hz solver that produce bounded ramp flight and landing from
      physical forces; fully supported input-free rest settling now
      derives corrective torque impulse from local inertia and releases outside
      shared low-energy thresholds; manual righting alone receives a bounded
      inertia-derived upright landing capture,
- [x] presentation-only smoke and feedback thresholds; ordinary rear-tire
      density now follows final applied lateral force times lateral scrub speed,
      release hysteresis is shared policy, straight braking cannot invent smoke
      without observed longitudinal slip, and the countdown burnout remains an
      explicit supported-rear-wheel presentation approximation,
- [x] classify gravity as a fixed world/environment value and replace the
      previous 18 m/s² handling value with Earth-standard 9.81 m/s²; tire
      stiffness now derives from contact load so the environment change does
      not require a compensating kart override,
- [x] formalize one canonical four-layer handling architecture before the 3A
      gate closes: future authored construction inputs, versioned derived kart
      physics, world/environment values, and shared gameplay policy, with
      ephemeral runtime state owned by the physics solver rather than treated
      as another tuning source; presentation remains a downstream observer and
      competitive runs pin a composite ruleset rather than mutating kart
      revisions,
- [x] after parameter classification, establish one human-readable kart-system
      documentation index with nested sections for authored construction,
      builder components and materials, world/environment values, derivation
      formulas, runtime solver types, shared policy, and presentation types;
      every section must identify its source of truth, units, versioning rules,
      and owning code contract, while catalogs not defined until 3B are clearly
      marked as future rather than filled with speculative entries; the index
      now begins at `docs/kart-system/README.md`,
- [x] split the transitional monolithic `KartTuning` contract along those
      ownership boundaries and make developer diagnostics identify each value's
      owner plus whether it is authored, derived, shared policy, environmental,
      presentation-only, or runtime-observed; runtime subsystems now consume a
      nested `KartPhysicalProfile` or `WorldEnvironment`, while the flat
      development adapter is session-only and exposes explicit metadata,
- [x] map the exact functional-part or geometry inputs for every per-kart
      derived output, including mass properties, collision/wheel geometry, all
      ten `KartPhysicalProfile` fields, the five tire/surface interaction
      values, and the environment/runtime boundaries in
      `docs/kart-system/derivation-formulas.md`, with no override path, and
- [x] accept the baseline component-count manifest: one freely available sealed
      battery, receiver/speed-controller, motor, steering, and combined braking
      component; two freely available transmissions, suspension units, and
      wheel/tire assemblies whose modeled tradeoffs create the official-kart
      specializations; chassis and body remain authored construction rather
      than sealed functional categories; no complete component has a
      progression tier and the manifest does not anticipate the later
      component-engineering part catalog, and
- [x] predict the balanced, speed, and handling assemblies before authoring:
      with the same default battery and motor, speed combines taller gearing,
      larger wheels, a firm suspension, longer wheelbase, moderately narrower
      track, and low-drag construction; handling combines 8:1 reduction,
      smaller wheels, compliant long-travel suspension, shorter wheelbase,
      wider track, and low centralized mass; balanced combines taller gearing
      with smaller wheels, intermediate geometry, and intermediate effective
      suspension leverage. The expected unconstrained acceleration order is
      handling, balanced, then speed, while runtime grip may cap or compress
      those differences.

The mastery gate passes only when the feature lead can explain representative
cause-and-effect relationships, every existing field has a justified
classification, the canonical handling architecture and developer diagnostics
make ownership explicit, per-kart outputs have explicit construction inputs,
shared policy cannot vary accidentally by kart, and the simplified model passes
controlled fixtures plus a complete race. Record accepted engine-independent,
tool-specific, and implemented knowledge through the repository Skills Tree.

#### PR 3B: Kart Document, Derivation, And Persistence

- [ ] define a versioned, validated kart-assembly document contract separate
      from the course document and from any future component-engineering
      document,
- [ ] define a versioned approved-component registry and ship the accepted 3A
      component-count manifest before the kart assembly editor is considered
      complete: at least one freely available sealed default in every required
      functional category, including one battery and one motor, and a second
      component only where its comprehensible physical tradeoff is modeled by
      the current solver rather than invented as a strict upgrade; component
      definitions own their internal construction, materials, physical
      attributes, and derivation, while kart documents reference immutable
      component/version IDs, transforms, attachment points, and allowed
      instance configuration,
- [ ] populate the nested builder-facing component and material catalog from
      the accepted typed registries, documenting every available part's stable
      ID, construction bounds, physical attributes, and derived outputs
      without creating a second editable source of numerical truth,
- [ ] keep documentation and typed registries synchronized through a
      completeness check so every builder-visible component, material,
      environment entry, derived output, runtime solver type, and presentation
      type has one discoverable human-readable reference,
- [ ] define bounded visual primitives and functional machine parts without
      accepting external models or custom assets,
- [ ] provide a functional suspension-unit primitive at wheel-station scale,
      with procedurally rendered coilover elements, bounded anchors and stroke,
      matched damping, bump-stop construction, motion-ratio derivation, and
      mirrored/focused editor controls instead of miniature mechanical CAD or
      direct spring/damper statistics; the required kart builder places an
      approved suspension component and does not engineer its internal spring,
      damper, or bump stop,
- [ ] give approved functional components stable IDs without adding progression
      or entitlement requirements to the assembly catalog,
- [ ] validate part counts, transforms, dimensions, wheel layout, complexity,
      and required functional structure,
- [ ] implement the accepted deterministic part-to-physics and player-stat
      derivation contract with no override path,
- [ ] persist player-owned kart heads, immutable revisions, derivation versions,
      resolved snapshots, and append-only official publication history,
- [ ] protect initial create, save, publish, and unpublish APIs with authoritative
      admin authorization while retaining the ownership model required by
      Community Karts,
- [ ] stop before breakable-joint metadata, damage behavior, or external asset
      storage.

#### PR 3C: Admin Kart Builder

- [ ] build a protected kart assembly editor that reuses generalized selection,
      gizmo, snapping, history, responsive inspector, and camera capabilities
      without coupling kart documents to course semantics or requiring
      component engineering,
- [ ] support freeform placement, attachment, mirroring, and live validation of
      approved component instances plus the accepted bounded structural/visual
      primitives, without exposing component-internal physical statistics,
- [ ] show dimensions, mass properties, wheel geometry, derived runtime
      behavior, and practical player-facing stats without editable raw tuning,
- [ ] provide controlled test fixtures and complete-race launch from the draft,
- [ ] support draft save, immutable revision creation, publish, and unpublish,
- [ ] create and publish the Balanced Kart through the real admin pipeline,
      then replace the transitional reference fixture as the default runtime
      kart before expanding the roster,
- [ ] verify keyboard, narrow touch, accessible controls, cancellation, and
      editor/runtime cleanup.

#### PR 3D: Official Kart Roster And Runtime Integration

- [ ] construct kart visuals, compound collision geometry, wheels, mass
      properties, and the simplified handling profile from validated immutable
      revisions,
- [ ] retain the Balanced Kart authored through the real admin pipeline in PR
      3C, then create speed and handling karts through that same pipeline
      without special-case tuning or manual overrides,
- [ ] show name, assembler credit, visual identity, derived stat bars, and a
      short practical descriptor in public kart selection,
- [ ] make published official revisions playable and remove unpublished entries
      from ordinary selection,
- [ ] retain a validated bundled official-roster fallback for frictionless guest
      play when persistence is unavailable,
- [ ] run full physics, collision, camera, input, resilience, responsive, and
      complete-race regression QA.

#### Deferred component-engineering phase boundary

Component engineering is not part of Phase 3 and must be planned as a later
phase rather than added opportunistically after PR 3D. That phase must debrief
component-definition ownership, authorization, internal primitive/material
bounds, derivation versioning, publication, and compatibility with existing
kart revisions. Progression unlocks component-engineering parts, not complete
kart-assembly components. Every engineered component derives its required tier
from the highest-tier part it contains. Neither the tier nor the resulting
physical statistics may be overridden.

After Phase 3 is implemented and verified, run the final proportional
integration review across tuning simplification, deterministic derivation,
admin authoring, publication, selection, and all three playable official karts
before merging the final phase work into `main`.

### Phase 4: Agricultural Zone Track

Goal: make the rough loop feel like Titan Racers.

Includes:

- [ ] 2-lap route,
- [ ] hydroponic/service-lane layout,
- [ ] scaled-down kart feel,
- [ ] oversized habitat infrastructure,
- [ ] irrigation tunnel,
- [ ] glass canopy / hero vista,
- [ ] hints of Cylinder curvature or larger habitat beyond the route.

### Phase 5: Solo, Ghosts, Results, Leaderboard

Goal: make solo play replayable.

Includes:

- [ ] solo time trial,
- [ ] developer ghost,
- [ ] player-best ghost,
- [ ] result screen,
- [ ] replay flow,
- [ ] player-facing authentication and explicit account-linking experience,
- [ ] connected EOA login through SIWE without making wallet addresses the
      canonical Titan Racers user identity,
- [ ] login-gated leaderboard submission,
- [ ] persistent authenticated-player progression tiers awarded through
      explicit Agricultural Zone best-time medal thresholds, beginning with a
      foundational finish tier and progressing through bronze, silver, and
      gold; a later component-engineering phase may map these achievements to
      component-part entitlements, but Phase 5 does not unlock complete
      assembly components,
- [ ] keep guests' frictionless racing independent of persistent progression,
- [ ] revision-aware race and result identity that records the stable course ID
      and immutable publication revision without hard-coding the official
      course.

Keep Phase 5 wallet scope to authentication and account linking. Embedded
wallets, token balances, gameplay transaction signing, and other on-chain
behavior require a separately accepted future scope.

### Phase 6: Community Karts And Structural Breakage

Goal: let every logged-in player build, publish, discover, and race bounded
community karts, then prove that authored construction can fail in a readable,
forgiving way.

Reuse the validated Phase 3 kart document, derivation, editor, revision, and
runtime pipeline. Do not create a second community format, expose raw tuning, or
grant creators numerical stat or joint-strength overrides. Community karts begin
as casual-race entries and do not enter the Demo v1 solo leaderboard until the
derived balance contract receives separate competitive validation.

#### PR 6A: Player Kart Ownership And Publishing

- [ ] extend the protected kart editor into a role-aware player authoring
      experience without exposing official-roster or admin controls,
- [ ] let logged-in players create, load, edit, and save only their own private
      kart drafts,
- [ ] let owners immediately publish validated immutable revisions and publish
      newer revisions without mutating earlier publications,
- [ ] let owners unpublish their own karts while retaining revision history,
      attribution, and historical race identity,
- [ ] enforce ownership, document validation, bounded text and construction,
      deterministic server-owned derivation, the baseline approved-component
      catalog, and publish-rate limits at server and data boundaries,
- [ ] keep guests out of persistent authoring and publishing.

#### PR 6B: Community Kart Discovery, Play, And Safety

- [ ] add a public catalog that clearly distinguishes official and community
      karts,
- [ ] let guests and logged-in players select and race any currently published
      valid community kart in casual modes,
- [ ] bind each race to a stable kart ID and immutable publication revision,
- [ ] let admins feature and unfeature published community karts without
      changing derived stats or competitive eligibility,
- [ ] let admins safety-unpublish broken, malicious, or inappropriate karts
      without deleting immutable history or administrative audit data,
- [ ] keep unpublished and safety-unpublished karts out of discovery and
      ordinary guest play,
- [ ] stop before external assets, marketplace behavior, collaborative editing,
      comments, or community-kart leaderboard eligibility.

#### PR 6C: Structural Joints And Forgiving Breakage

- [ ] research and approve the engine-independent structural-damage standard and
      its PlayCanvas/Ammo mapping before implementation,
- [ ] extend the kart document with versioned stable joints connecting authored
      parts while preserving earlier immutable revisions,
- [ ] derive bounded joint strength from connected part roles, mass, geometry,
      and connection placement without creator-entered damage numbers,
- [ ] validate structural coherence and upgrade the three official karts through
      the same public document-version path,
- [ ] derive environment-impact severity from kart mass, contact velocity,
      contact normal, and angle of attack,
- [ ] accumulate joint damage and detach parts deterministically after
      sufficiently severe wall, obstacle, or fall impacts,
- [ ] keep ordinary contact forgiving and preserve a usable racing core rather
      than creating a complex damage simulation,
- [ ] verify glancing impacts, direct impacts, scraping, repeated smaller hits,
      falls, detached-part cleanup, reset/recovery, and race completion.

After Phase 6 is implemented and verified, run the final proportional
integration review across player kart ownership, deterministic derivation,
immediate publication, discovery, safety controls, immutable revision identity,
structural authoring, and environment-impact breakage before merging the final
phase work into `main`.

### Phase 7: Community Courses

Goal: let players publish, discover, race, and curate community-made courses
without a pre-publication approval queue.

Deliver community courses through three independently reviewable PR-sized
units. Reuse the validated portable course-document and immutable-revision
foundation; do not create a second course format or a separate editor.

#### PR 7A: Player Course Ownership And Publishing

- [ ] extend the protected editor into a role-aware player authoring experience
      without exposing admin-only controls,
- [ ] let logged-in players create, load, edit, and save only their own private
      course drafts,
- [ ] let owners immediately publish validated immutable revisions and publish
      newer revisions without mutating earlier publications,
- [ ] let owners unpublish their own courses while retaining revision history,
      attribution, and historical race identity,
- [ ] enforce ownership, validation, bounded text, and publish-rate limits at
      server and data boundaries,
- [ ] keep guests out of persistent authoring and publishing.

#### PR 7B: Public Course Discovery And Play

- [ ] add a public catalog that clearly distinguishes the official Agricultural
      Zone Service Circuit from community courses,
- [ ] support featured, popular, and newly published discovery views,
- [ ] let guests and logged-in players launch any currently published course,
- [ ] bind each race to a stable course ID and immutable publication revision,
- [ ] preserve official-course selection and recovery behavior while removing
      any rough-course or Agricultural Zone assumptions from shared race
      systems,
- [ ] stop before custom course assets, collaborative editing, comments, or
      community-course-specific ghosts and leaderboards.

#### PR 7C: Community Ranking, Featuring, And Safety Controls

- [ ] let each logged-in player add or remove one thumbs-up per published
      community course,
- [ ] keep community ranking data distinct from admin featuring,
- [ ] let admins feature and unfeature published community courses,
- [ ] let admins safety-unpublish broken, malicious, or inappropriate courses
      without deleting their immutable history or administrative audit trail,
- [ ] keep unpublished courses out of discovery and ordinary guest play,
- [ ] verify ownership, ranking integrity, rate limits, authorization, public
      catalog behavior, and narrow-screen authoring and discovery.

After Phase 7 is implemented and verified, run the final proportional
integration review across player authoring, immediate publication, discovery,
ranking, featuring, safety unpublishing, and revision-aware racing before
merging the final phase work into `main`.

### Phase 8: Private Multiplayer

Goal: make the demo social while treating networked kart contact as an explicit
authoritative gameplay system.

#### PR 8A: Private Rooms And Race Lifecycle

- [ ] private room creation and join by link,
- [ ] 2-4 players with guest joining,
- [ ] kart selection equals ready,
- [ ] host start and synchronized countdown,
- [ ] visible opponents and coherent race progression,
- [ ] synchronized results and replay in the same room,
- [ ] timeout so the race ends when all active players finish or shortly after
      the first finisher.

#### PR 8B: Multiplayer Motion And Resilience

- [ ] define server authority, input/state cadence, prediction, interpolation,
      reconciliation, and bounded correction behavior,
- [ ] keep remote presentation separate from authoritative race, collision, and
      damage state,
- [ ] handle latency, packet loss, reordering, backgrounding, disconnects,
      reconnects, and host departure without hanging the room or results,
- [ ] preserve keyboard, touch, gamepad, reset, pause, and runtime-resilience
      behavior in multiplayer.

#### PR 8C: Multiplayer Collisions And Damage Synchronization

- [ ] establish one authoritative kart-to-kart collision outcome so two clients
      cannot apply the same contact twice,
- [ ] derive impact severity from both karts' mass, relative contact velocity,
      contact normal, and angle of attack,
- [ ] synchronize collision impulses, accumulated authored-joint damage, and
      detached parts through the Phase 6 structural contract,
- [ ] reconcile collision and damage state under latency, packet reordering,
      disconnects, reconnects, and simultaneous environment contact,
- [ ] prevent remote tunneling, explosive correction impulses, duplicate
      damage, and permanently divergent detached-part state,
- [ ] verify low-speed rubbing, glancing contact, rear-ending, head-on impact,
      pileups, airborne contact, wall pinning, and concurrent kart/environment
      impacts,
- [ ] preserve the forgiving damage target and complete-race behavior.

After Phase 8 is implemented and verified, run the final proportional
integration review across room lifecycle, race authority, motion resilience,
kart-to-kart collisions, structural damage synchronization, and replay before
merging the final phase work into `main`.

### Phase 9: Public Demo Polish

Goal: make it ready to share.

Includes:

- [ ] controller polish,
- [ ] result sharing,
- [ ] mobile performance pass,
- [ ] analytics review,
- [ ] lobby polish,
- [ ] onboarding copy,
- [ ] UI clarity,
- [ ] final visual pass against the Titan Racers site.

When the final phase is complete and the demo is accepted, remove this implementation plan from the repo. The shipped app, README, and durable docs should become the source of truth.

## Verification Plan

Each playable phase should be checked with:

- desktop keyboard playthrough,
- mobile viewport/touch playthrough,
- gamepad playthrough once Phase 2 exists,
- at least one complete two-lap race,
- result timing sanity check,
- build/lint/test commands,
- visual inspection against the site aesthetic.

Multiplayer verification should include:

- host creates room,
- guest joins by link,
- players ready through kart selection,
- host starts race,
- opponents are visible,
- low-speed, glancing, rear-end, head-on, pileup, airborne, and wall-pinning
  contacts resolve once without divergent impulses or damage,
- authored-joint damage and detached parts remain synchronized under latency,
  reordering, disconnect, and concurrent environment impacts,
- results resolve without hanging,
- same room can replay.

Kart-dynamics mastery verification should include:

- every current tuning field has one justified classification,
- the feature lead predicts representative A/B outcomes before observing them,
- controlled fixtures isolate propulsion, steering, tire, braking/drift,
  suspension, chassis-contact, airborne, recovery, and presentation behavior,
- reasonable physical expectations and observed behavior agree or the model is
  corrected before continuing,
- the final kart-varying surface is materially smaller than the audited
  62-parameter implementation contract,
- every remaining per-kart output maps to explicit authored parts or geometry,
- shared policy, assists, and presentation settings cannot vary accidentally by
  kart.

Admin kart-authoring verification should include:

- unauthorized users blocked,
- admin can create a bounded primitive kart draft,
- draft can be edited,
- invalid construction cannot be saved or published as valid,
- derived physical values and stat bars are deterministic and cannot be
  overridden,
- a draft can launch controlled fixtures and a complete test race,
- published kart appears in public selection,
- unpublished kart disappears from public selection.

Community-kart verification should include:

- a player can create, save, publish, revise, and unpublish only their own kart,
- Agricultural Zone medal thresholds grant authenticated-player progression
  tiers once and cannot be forged by client state, without gating complete
  kart-assembly components,
- publishing is immediate and does not require admin approval,
- guests can browse and casually race a published community kart,
- a race remains bound to the immutable kart publication revision it started
  with,
- community karts cannot submit to the Demo v1 solo leaderboard,
- admin feature and safety-unpublish controls do not mutate derived stats or
  immutable history,
- structural joints and strength come only from validated construction,
- environment impacts produce forgiving, deterministic damage and reset-safe
  detached-part cleanup,
- unauthorized cross-owner and admin-only mutations are blocked.

Community-course verification should include:

- player can create, save, publish, revise, and unpublish only their own course,
- publishing is immediate and does not require admin approval,
- guest can browse and race a published community course,
- a race remains bound to the publication revision it started with,
- each player can add or remove only one thumbs-up per course,
- featured, popular, and new catalog views remain distinct,
- admin can feature, unfeature, and safety-unpublish a course,
- safety-unpublished courses disappear from public discovery without losing
  revision history or audit data,
- unauthorized cross-owner and admin-only mutations are blocked.

## First Build Agreement

Before coding the scaffold:

> Make the plan the first approved commit. Then build a Next/React demo app
> around a tiny engine spike, move quickly into fun RC-style driving with early
> gamepad support, master and simplify the kart-handling model, add the real
> admin-gated primitive kart authoring and publication pipeline, turn the rough
> loop into the Agricultural Zone, complete ghosts and leaderboard-ready
> results, open bounded kart and course creation to immediate player publishing
> and community discovery, then finish authoritative private multiplayer
> collisions and final demo polish.
