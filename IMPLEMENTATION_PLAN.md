# Titan Racers Demo v1 Implementation Plan

## Purpose

Build a browser-playable Titan Racers demo that proves the core fantasy:

> Race tiny buildable karts through forbidden service routes inside humanity's last Titan colony.

The demo is complete only when solo racing, uploaded/published kart designs,
ghosts, leaderboard-ready results, immediate community-course publishing and
discovery, private multiplayer, and controller support are all working.

## Alignment Summary

- Start with racing feel. The first playable center is a fun two-lap RC-style race in the Agricultural Zone.
- Private multiplayer is required for Demo v1 completion, but solo driving comes first so the handling can be tuned.
- Creator upload is required for the demo, launch-gated to the admin account first.
- Use "assembler" as a player capability, not a separate creator role.
- Kart cards should be practical and machine-focused, not lore-heavy.
- Use the existing Titan Racers site aesthetic and typography before inventing a new system.
- Use a Next/React-style app shell with a tiny engine spike before fully committing to the game runtime.
- PlayCanvas is the preferred runtime candidate, but the spike can challenge that if another path is clearly better.
- Use Postgres locally and Neon when hosted.
- Store larger assets in S3-compatible object storage; keep metadata in Postgres.
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
- Three playable published kart designs from the upload/publish pipeline.
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
- Admin-gated kart upload/register/edit/publish workflow.
- Basic analytics for learning whether the demo is fun.

### Explicitly Not Required For Demo v1

- Public kart uploads.
- Full creator marketplace.
- Patenting or licensing.
- On-chain gameplay.
- Token rewards.
- Deep economy.
- Global ranked multiplayer.
- Robust anti-cheat.
- Full production-quality art.
- Real-world kit export pipeline.
- Complex damage beyond the focused first-pass joint-breakage mechanic.
- Fuel or battery simulation.
- Advanced tire physics.
- Deep tuning UI.
- Overly punishing collisions.

## App And Technical Direction

### App Shell

Use a Next/React-style app shell unless the scaffold phase reveals a strong reason not to. The shell should own:

- mode selection,
- kart selection,
- auth UI,
- admin/assembler upload surfaces,
- results,
- leaderboard,
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
- assembler approval,
- kart drafts,
- published kart designs,
- model asset metadata,
- derived stats,
- stat overrides,
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

Store uploaded models and larger generated assets in S3-compatible object storage. The storage adapter should keep S3, DigitalOcean Spaces, Cloudflare R2, or similar services interchangeable.

Postgres stores object keys, URLs, ownership, status, and metadata.

### Auth And Authorization

Guest play must stay frictionless.

Login is required for:

- persistent racer identity,
- leaderboard submission,
- community-course authoring, publishing, and thumbs-ups,
- assembly upload access,
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
- Cannot upload kart designs.

### Player

- Logged-in identity.
- Can save display name/history.
- Can submit eligible solo leaderboard results.
- Can create and edit their own private course drafts.
- Can immediately publish validated revisions of their own courses.
- Can unpublish their own courses.
- Can give or remove one thumbs-up per published community course.

### Assembly-Enabled Player

- A normal player account with temporary allowlisted assembly permissions.
- "Assembler" is a voluntary player activity and social/meta identity, not a separate product role.
- Can create and edit their own kart drafts.
- Can upload/register 3D models.
- Can edit metadata and proposed stats.
- Cannot publish to public roster at launch unless admin also grants that capability later.

### Admin

- Trusted launch operator account with a Postgres-backed admin role.
- Multiple admins are allowed.
- Can manage temporary assembly access approval.
- Can access protected course/editor tooling.
- Can edit track layout and test-scene objects.
- Can feature or unfeature published community courses.
- Can safety-unpublish broken, malicious, or inappropriate community courses
  without deleting their revision history.
- Can upload/edit kart designs.
- Can review derived stats.
- Can override stats.
- Can publish/unpublish roster entries.

## Kart Upload And Design System

The demo should prove that karts are machines, not skins.

Minimum workflow:

1. Admin uploads or registers a 3D kart model.
2. System stores model asset metadata.
3. System reads rough model dimensions where practical.
4. System derives starter stats.
5. Admin can edit metadata.
6. Admin can manually override stats.
7. Admin publishes/unpublishes the kart.
8. Published karts appear in player-facing kart selection.

Future assembly-enabled players should use the same draft pipeline, gated by temporary permission until assembly is ready to release to everyone.

First-pass stat derivation should stay approximate and overrideable. Useful heuristics include:

- bounding box size for approximate body size,
- rough volume for approximate weight,
- heavier builds trading acceleration for stability,
- larger wheels helping obstacle handling with possible turning tradeoffs,
- wider wheelbase increasing stability but reducing tight turning,
- lower body height improving stability,
- longer body improving straight-line stability but reducing cornering.

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
- multiplayer is room-only for v1.

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

- [ ] focus loss, visibility change, resize, input cancellation, lower frame
      rate, loading, and WebGL/context failure behavior,
- [ ] summarized runtime-health reporting through the PR 5A gameplay-run
      contract and dashboard,
- [ ] integrated Phase 2 verification and independent review.

Phase 2 remains limited to one rough kart and a rough test loop. Kart uploads,
Agricultural Zone visual production, ghosts, leaderboard submission, and
multiplayer remain in their later phases.

### Phase 3: Kart Design And Upload System

Goal: prove karts are machines, not skins.

Includes:

- [ ] admin-gated upload/register flow,
- [ ] model asset storage integration,
- [ ] rough model dimension reading where practical,
- [ ] starter stat derivation,
- [ ] manual stat overrides,
- [ ] a minimal authored breakable-joint metadata contract for the three demo
      karts, without a general-purpose rigging or damage-authoring system,
- [ ] publish/unpublish,
- [ ] three playable uploaded/published karts.

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
- [ ] revision-aware race and result identity that records the stable course ID
      and immutable publication revision without hard-coding the official
      course.

Keep Phase 5 wallet scope to authentication and account linking. Embedded
wallets, token balances, gameplay transaction signing, and other on-chain
behavior require a separately accepted future scope.

### Phase 6: Community Courses

Goal: let players publish, discover, race, and curate community-made courses
without a pre-publication approval queue.

Deliver community courses through three independently reviewable PR-sized
units. Reuse the validated portable course-document and immutable-revision
foundation; do not create a second course format or a separate editor.

#### PR 6A: Player Course Ownership And Publishing

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

#### PR 6B: Public Course Discovery And Play

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

#### PR 6C: Community Ranking, Featuring, And Safety Controls

- [ ] let each logged-in player add or remove one thumbs-up per published
      community course,
- [ ] keep community ranking data distinct from admin featuring,
- [ ] let admins feature and unfeature published community courses,
- [ ] let admins safety-unpublish broken, malicious, or inappropriate courses
      without deleting their immutable history or administrative audit trail,
- [ ] keep unpublished courses out of discovery and ordinary guest play,
- [ ] verify ownership, ranking integrity, rate limits, authorization, public
      catalog behavior, and narrow-screen authoring and discovery.

After Phase 6 is implemented and verified, run the final proportional
integration review across player authoring, immediate publication, discovery,
ranking, featuring, safety unpublishing, and revision-aware racing before
merging the final phase work into `main`.

### Phase 7: Private Multiplayer

Goal: make the demo social.

Includes:

- [ ] private rooms,
- [ ] join by link,
- [ ] 2-4 players,
- [ ] kart selection equals ready,
- [ ] host start,
- [ ] countdown,
- [ ] visible opponents,
- [ ] synced results,
- [ ] replay same room.
- [ ] timeout rule so the race ends when all active players finish or shortly after the first finisher.
- [ ] synchronized kart-joint damage and breakage from crashes using the
      authored joint metadata established for the three demo karts,
- [ ] impact severity derived from the involved karts' mass, relative velocity,
      and angle of attack,
- [ ] joint damage and breakage from sufficiently severe wall impacts or falls,
- [ ] a forgiving first-pass breakage model that creates dramatic race moments
      without expanding into a complex damage simulation.

### Phase 8: Public Demo Polish

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
- results resolve without hanging,
- same room can replay.

Admin/upload verification should include:

- unauthorized users blocked,
- admin can upload/register model,
- draft can be edited,
- stats can be overridden,
- published kart appears in public selection,
- unpublished kart disappears from public selection.

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
> gamepad support, add the real admin-gated kart upload/publish pipeline, turn
> the rough loop into the Agricultural Zone, complete ghosts and
> leaderboard-ready results, open the bounded course editor to immediate
> player publishing and community discovery, then finish private multiplayer
> and final demo polish.
