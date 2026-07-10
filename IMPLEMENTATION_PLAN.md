# Titan Racers Demo v1 Implementation Plan

## Purpose

Build a browser-playable Titan Racers demo that proves the core fantasy:

> Race tiny buildable karts through forbidden service routes inside humanity's last Titan colony.

The demo is complete only when solo racing, uploaded/published kart designs, ghosts, leaderboard-ready results, private multiplayer, and controller support are all working.

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
- Privy is the leading auth candidate, but should be stress-tested against the exact demo needs before final selection.
- Target the playable app as a separate experience from the marketing site, likely `play.titanracers.com`.

## Product Scope

### Required For Demo v1

- Mobile-friendly playable web app.
- Fast guest entry into racing.
- One playable track: Agricultural Zone Service Circuit.
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
- multiplayer room records where useful.

Use local Postgres for development and Neon for hosted environments.

The backend should expose API surfaces for player, kart, race, room, result, and leaderboard data. Multiplayer also needs a realtime server or realtime-capable service; exact framework should be chosen during implementation.

### Asset Storage

Store uploaded models and larger generated assets in S3-compatible object storage. The storage adapter should keep S3, DigitalOcean Spaces, Cloudflare R2, or similar services interchangeable.

Postgres stores object keys, URLs, ownership, status, and metadata.

### Auth

Guest play must stay frictionless.

Login is required for:

- persistent racer identity,
- leaderboard submission,
- assembly upload access,
- admin controls,

Privy is the leading candidate, but final auth choice should wait until the scaffold phase stress-tests it against guest play, admin permissions, assembly access approval, and wallet/social identity needs.

## Roles And Permissions

Use a simple player-centered model.

### Guest

- Can race casually.
- Can join private rooms.
- Can see local race results.
- Cannot submit to global leaderboard.
- Cannot upload kart designs.

### Player

- Logged-in identity.
- Can save display name/history.
- Can submit eligible solo leaderboard results.

### Assembly-Enabled Player

- A normal player account with temporary allowlisted assembly permissions.
- "Assembler" is a voluntary player activity and social/meta identity, not a separate product role.
- Can create and edit their own kart drafts.
- Can upload/register 3D models.
- Can edit metadata and proposed stats.
- Cannot publish to public roster at launch unless admin also grants that capability later.

### Admin

- Trusted launch operator account, allowlisted through environment/config at first.
- Multiple admins are allowed.
- Can manage temporary assembly access approval.
- Can access protected course/editor tooling.
- Can edit track layout and test-scene objects.
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

- left stick: steer,
- right trigger: accelerate,
- left trigger: brake/reverse,
- A button: boost if boost exists,
- Y button: reset/recover,
- menu/start: pause.

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

## Track Direction

One track:

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
- login conversion after race.

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

- [ ] collision behavior for barriers, corners, obstacles, ramps, glancing
      impacts, snagging, bounce, spin, and tunneling,

#### PR 2C: Chase-Camera Mastery

- [ ] chase-camera behavior driven by actual kart motion, orientation, slip,
      impacts, and airborne state.

After PR 2C is implemented and verified, run the final proportional integration
review for the complete driving-simulation phase before merging its final work
into `main`.

#### PR 3: Protected Course Tooling

- [ ] define and implement the required editable course-data model,
- [ ] establish selection, transform, placement, checkpoint/start placement,
      collision visualization, persistence/export, undo, and reset behavior,
- [ ] add Privy authentication,
- [ ] enforce an environment-configured admin allowlist at both the UI and
      server authorization boundaries.

#### PR 4: Rough Race Loop

- [ ] unified keyboard, mobile touch, and early gamepad/controller input,
- [ ] explicit loading, ready, countdown, racing, paused, recovering, and
      finished states,
- [ ] ordered checkpoints, laps, timer, and invalid-progression handling,
- [ ] safe checkpoint recovery with orientation and velocity reset,
- [ ] a rough test loop that can be completed through every supported input.

#### PR 5: Telemetry And Runtime Resilience

- [ ] provider-neutral analytics event contract,
- [ ] privacy-conscious Postgres gameplay telemetry using anonymous guest
      sessions and summarized events rather than per-frame data,
- [ ] Vercel Web Analytics for page, performance, and supported funnel events,
- [ ] focus loss, visibility change, resize, input cancellation, lower frame
      rate, loading, and WebGL/context failure behavior,
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
- [ ] login-gated leaderboard submission.

### Phase 6: Private Multiplayer

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

### Phase 7: Public Demo Polish

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

## First Build Agreement

Before coding the scaffold:

> Make the plan the first approved commit. Then build a Next/React demo app around a tiny engine spike, move quickly into fun RC-style driving with early gamepad support, add the real admin-gated upload/publish pipeline, turn the rough loop into the Agricultural Zone, then complete ghosts, leaderboard-ready results, private multiplayer, and final demo polish.
