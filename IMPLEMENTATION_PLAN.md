# Titan Racers Demo v1 Implementation Plan

Titan Racers is a browser-playable demo built to prove one idea:

> Race tiny buildable karts through forbidden service routes inside humanity's
> last Titan colony.

Demo v1 is done when solo racing, official and community karts built from
primitives, ghosts, leaderboard-ready results, community kart and course
publishing, private multiplayer, and controller support all work.

This file is the source of truth for remaining scope. Delete it once Demo v1 is
accepted; the app, README, and durable docs take over from there.

## Status

- **Done:** Phases 0–3 (PRs #1–#24, the Phase 3 closeout, and its follow-ups).
- **Next:** Phase 4: visual baseline, Island Three, and the Agricultural
  Zone.

## Guiding Decisions

These still constrain every remaining phase.

- **Racing feel comes first.** The core is a fun two-lap RC-style race.
- **Karts are machines, not skins.** Behavior comes from validated construction
  through a versioned derivation. There are no manual stat overrides; if a
  reasonable build behaves badly, fix the editor, parts, derivation, or physics.
- **History is immutable.** Saved kart and course revisions never change.
  A kart revision stores its derived snapshot, and races use that snapshot. A
  published part version (`id@version`) never changes; add a new version
  instead. Competitive runs pin a ruleset version rather than changing kart
  revisions.
- **Each phase adds its own analytics events** as it lands (logins,
  leaderboard submissions, rooms, shares, community publishing and play,
  thumbs-ups, input type, and drop-off before or during a race).
- **Guests race without logging in.** Login is only for persistent identity,
  leaderboard submission, authoring, ranking, and admin tools.
- **Titan Racers user IDs are canonical.** Login providers, wallets, and future
  embedded wallets attach to the app user and never replace it.
- **Permissions are checked on the server.** Roles live in Postgres. Client-side
  checks only shape the UI. No public role-promotion endpoint or deployment
  allowlist grants roles.
- **"Assembler" is a capability, not a role.** Admins assemble official karts
  now; every logged-in player gets the same tools in Phase 6.
- **Kart cards stay practical.** Short machine-focused descriptors, no lore.
- **Match the existing Titan Racers site** (see [Visual Direction](#visual-direction)).
- **Ship separately from the marketing site,** likely at `play.titanracers.com`.

## Stack

- **App shell:** Next.js (React) for mode and kart selection, auth, authoring,
  results, leaderboards, community catalogs, rooms, sharing, and analytics.
- **Game runtime:** PlayCanvas with Ammo physics, chosen in the Phase 1 spike.
- **Data:** Postgres locally and Neon when hosted, with Drizzle migrations.
- **Auth:** Better Auth with Postgres-backed sessions. Google login exists for
  admins today; player login and SIWE wallet linking arrive in Phase 5. The
  first admin is bootstrapped by a database script
  (`docs/database-operations.md`).
- **Analytics:** Vercel Web Analytics for anonymous page views, plus small
  gameplay-run summaries in Postgres with an admin dashboard.
- **Assets:** karts and courses are bounded primitive documents, so no file
  storage is needed. Textures and models are reviewed repository assets that
  ship with the app (see Phase 4). Add a reviewed S3-compatible boundary only
  if player uploads arrive after Demo v1.
- **Multiplayer transport:** to be chosen in Phase 8.

## Scope

### In Demo v1

- Mobile-friendly web app with fast guest entry into racing.
- One official track: the Agricultural Zone Service Circuit.
- Two-lap solo time trial with a result screen after every race.
- Three official karts (Balanced, Speed, Handling) with distinct handling, each
  showing name, assembler credit, visual identity, stat bars, and a short
  descriptor.
- Keyboard, touch, and gamepad controls, plus fast reset.
- Developer ghost and player-best ghost.
- Login-gated solo leaderboard.
- Agricultural Zone best-time medals that set progression tiers.
- Admin kart builder; after Phase 5, player-built community karts with
  immediate publishing, discovery, and admin safety unpublishing.
- Player-built community courses with immediate publishing, thumbs-ups, admin
  featuring, and safety unpublishing.
- Private 2–4 player multiplayer rooms that guests can join by link.
- Basic analytics to learn whether the demo is fun.

### Not In Demo v1

- External model or custom asset uploads.
- Marketplace, patenting, licensing, or a deep economy.
- On-chain gameplay or token rewards.
- Global ranked multiplayer or robust anti-cheat.
- Hand-finished production art or a real-world kit export pipeline. Phase 4
  sets a demo-sized visual baseline instead.
- Damage beyond the simple joint-breakage model in Phase 6.
- Fuel or battery simulation, advanced tire physics, or punishing collisions.
- Player-editable numerical tuning or raw handling controls.

## Roles

| Role | Can do |
| --- | --- |
| Guest | Race official and published community karts and courses, join private rooms, see local results. Cannot submit leaderboard times or save designs. |
| Player | Everything a guest can, plus a persistent racer identity and history, leaderboard submission, building and publishing their own karts (Phase 6) and courses (Phase 7), and one thumbs-up per community course. |
| Admin | Protected course and kart editors; create, revise, publish, and unpublish official karts and courses; feature or safety-unpublish community karts and courses without deleting history; inspect derived kart stats, never override them. Several admins are allowed. |

## Visual Direction

Match the current Titan Racers site: near-black base, ice text, orange and
hazard-yellow signals, steel-blue technical accents, Arial/Helvetica-style sans,
Courier-style mono labels, bold uppercase headings, widely tracked operational
labels, sharp industrial borders, and restrained panels.

The HUD should feel like a racing operations interface, not a lore panel or a
neon arcade skin. The main multiplayer call to action should read like
"Race Friends".

## How We Work

- **Process:** `docs/session-workflow.md` covers debriefs, approvals, commit
  gates, independent review, and the integration review that closes each
  multi-PR phase. `docs/pr-review-workflow.md` covers PR feedback.
- **PR numbering:** `PR <phase>.<n>`, or `PR <phase>.<stage>.<n>` when a phase
  needs stages. Numbers never change once assigned.
- **Knowledge first:** for substantial game systems, record researched
  standards in `skills/game-concepts/`, engine-specific behavior in
  `skills/tools/`, and the shipped system in `skills/project-systems/` after it
  is accepted. Add only the layers that own distinct content
  (see `skills/README.md`).
- **Every playable phase is checked with:** keyboard, touch, and gamepad
  playthroughs; at least one complete two-lap race; a result-timing sanity
  check; lint, typecheck, build, and relevant tests; and a visual check against
  the site.

## Completed Phases

Details live in git history, `docs/kart-system/`, and `skills/project-systems/`.

| Phase | What shipped | PRs |
| --- | --- | --- |
| 0. Plan and foundation | App scaffold, scripts, site visual tokens and assets. | #1 |
| 1. Engine spike | PlayCanvas chosen; canvas and mobile rendering proven. | #2 |
| 2. Driving prototype | Gameplay architecture and agent Skills Tree; dynamic kart physics, collisions, and chase camera; course documents, Postgres, auth, and roles; protected course editor with private drafts and publishing; unified keyboard, touch, and controller input; race lifecycle with checkpoints, laps, and recovery; telemetry dashboard and runtime resilience; handling and mobile polish, manual righting, and editor multi-select. | #3–#18 |
| 3. Kart dynamics and admin kart builder | Handling model cut from 62 tuning values to 16 with clear owners; versioned kart documents, approved part registry, deterministic derivation, immutable revisions, and publication; admin kart builder; editor controller input; three official karts in public selection with thumbnails and racer usernames; integration review and its two fixes. | #19, #21–#24, closeout |

Decisions from completed phases that later phases rely on:

- `rough-course` is the permanent editor and physics sandbox. The official track
  uses its own course ID, `agricultural-zone`, and publishing or guest play must
  never mix the two.
- Gameplay telemetry stays small: one summarized record per run, with no raw
  input, per-frame, hardware-identity, or player-journey capture.
- Course revision history and restore, real-time collaboration, and multi-author
  merging are later tooling, not Demo v1.
- **Component engineering is a separate later phase.** Kart assembly uses
  sealed, freely available parts with no progression tiers. If component
  engineering is planned, progression unlocks engineered *parts*, an engineered
  component's tier is the highest tier among its parts, and neither tiers nor
  stats can be overridden.

## Remaining Phases

### Phase 4: Visual Baseline, Island Three, And The Agricultural Zone

**Goal:** give Titan Racers a consistent visual identity, physical surfaces,
and its home inside the Island Three habitat, then build the Agricultural Zone
Service Circuit there.

Phase decisions:

- **A visual identity, not plain realism.** Materials and lighting behave
  physically, but within one consistent identity that starts from the site
  palette. `docs/visual-identity.md` records it, and each PR refines it.
- **Karts are 1:10 RC scale, and realism lives in the parts.** Each approved
  part version gets a presentation-only visual. Every kart, including future
  community karts, improves without changing derivation, revisions, or hashes.
- **Assets mix code-built geometry, CC0 textures, and repository-owned
  models,** including models generated in separate sessions. All are reviewed
  and committed to the repository; players still cannot upload assets. Pull
  back if the work drifts toward production art.
- **Island Three is the enclosure for every course.** It spins for 1 g at the
  floor (radius about 4 km). Courses name an enclosure and their placement in
  it, so nothing is hard-coded to the Agricultural Zone. The distant cylinder
  renders as its own layer, and course physics stays local.
- **Rotating-habitat physics at true scale.** Position-dependent artificial
  gravity (`g × r / R`) plus Coriolis force replace the fixed Earth gravity
  under a new physics version, with no exaggeration.
- **Near-axis, low-gravity racing belongs to a later course** placed near the
  axis, not to the Agricultural loop.
- **A phone performance budget** is set in PR 4.1.2 and holds for the rest of
  the phase. `docs/visual-identity.md` owns it and the art direction.

**PR 4.0: Phase 4 plan**

- [x] Rewrite Phase 4 and move the shared kart visual builder up from Phase 6.

**PR 4.1: Kart visual baseline**

- [x] 4.1.1: One shared kart visual builder for race, editor, and thumbnails,
      with no visual change.
- [x] 4.1.2: Lighting baseline (environment lighting, tone mapping, shadows),
      phone performance budget, look exploration on one kart, and the first
      `docs/visual-identity.md`.
- [x] 4.1.3: Presentation-only visuals for each approved part version, with
      materials that follow the identity; regenerate official kart thumbnails.
- [x] 4.1.4: Visuals for authored primitives (chassis, body shells, guards,
      trim, and mass blocks), generated at each primitive's size from its role,
      material, and solid or shell construction, staying inside its envelope.
      Scope grew to rebuild the official karts as open 1:10 RC chassis (plate,
      hinge-pin mounts, shock towers, top deck, bumpers) with a retune and a
      wider stability score range (derivation version 4).

**PR 4.2: Sandbox surfaces**

- [x] 4.2.1: Road, grass, and marking visuals on `rough-course`. Align
      surface visuals with their collision tops: the asphalt is drawn 5 cm
      above where karts roll, hiding wheels and the low open chassis (found in
      PR 4.1.4). Scope grew into an intro-course pass: service-yard finishes
      and markings, a timing portal and props, a low bridge and kicker on the
      lap, the tall jump moved beside it, an infield barrier, three wider
      checkpoints, kart-scale shadows with a contact shadow, and no race-only
      start pad.
- [x] 4.2.2: Surface physics: a grass surface material and its tire
      interaction, per-surface materials in the course document (new schema
      version with normalization), and a new physics version. Scope grew to
      two grasses: short turf verges beside the asphalt and around the infield
      edge, with slower uncut lawn beyond, each with its own finish. The tall
      jump ramp sits 8 cm lower so its entry is flush with the ground, and
      karts spawn just behind the start line (a course spawn distance).
- [x] 4.2.3: High-speed collision robustness. Above top speed a kart travels
      farther per physics step than a thin wall is deep, so the solver can
      push it into the floor (found in PR 4.1.4; the old official karts did it
      too). Fix it with adaptive substeps or a leading-edge sweep under a new
      physics version, then tighten the thin-wall test from one step of
      overlap to a small fixed margin at any starting offset. Cover standard
      and grass approaches: at 20.4 m/s from x=-29.5, z=24, grass rolling
      resistance changes impact-step alignment and exposes deeper penetration.
      The existing CCD benchmark explicitly retains the standard interaction.
      Telemetry must keep accepting `surface-physics-v1` starts from clients
      still running the older build.
      Shipped as speed-adaptive Bullet substeps under `collision-substeps-v1`.
- [x] 4.2.4: Surface driving effects: grass clippings and bounded tire marks
      (rubber on asphalt, torn turf on grass) driven by wheel contact and
      slip. Marks last for the race; the oldest fade only when the pool is
      full.
      Presentation only, within the phone performance budget; debrief the
      effects before implementation. Also steadied the flickering kart shadow
      (4.2.2 phone QA) with PCF5 filtering on course lights.
- [x] 4.2.5: Grass visuals for the uncut lawn and the short turf. A
      comparison of code-built blades, photo scans, and scans with parallax
      depth chose flat CC0 photo scans; raised grass would hide wheels the
      physics keeps on a flat surface. Scope grew to scan the asphalt too.
      Scans load before the race's first frame, and the 4.2.4 clipping colours
      follow the scanned blades.
- [x] 4.2.6: Handbrake drift. Holding Shift with throttle jolted the rear
      left and right: the motor out-pulls the derived handbrake as the drift
      slows, so the rear re-gripped mid-slide. The handbrake now disengages
      drive (gameplay policy, physics version `handbrake-clutch-v1`). On
      touch, pulling the joystick back-diagonal at speed also pulls the
      handbrake, without the brake pedal.

**PR 4.3: Island Three**

- [x] 4.3.1: The cylinder enclosure as a distant render layer, enclosure and
      placement in the course document, and a tiny `agricultural-zone` loop
      inside it. Course schema v4 places each course in Island Three and
      replaces authored lights with the sun through its mirror, which reaches
      only a band of the valley. Races are lit by the habitat around the
      course. The Agricultural Zone became the solo time trial, and
      `rough-course` became the Starter Course, a sandbox for kart test drives.
      Both courses gained perimeter walls. The course editor opens from a
      course roster, and migration 0016 accepts official-course telemetry for
      both. Course lamps moved to 4.3.5: at real brightness they would not show
      until the habitat has a night.
- [x] 4.3.2: Rotating-habitat physics: a research note first, then
      position-dependent gravity and Coriolis through the kart controller,
      steering, righting, and camera up; optionally a near-axis test pad.
      Also decide shock installation angle and re-lay out each axle.
      Shipped as physics version `rotating-habitat-v1`: gravity from the
      kart's distance to the axis, Coriolis, local up, Island Three's
      half-pressure air, and a parked-kart hold on a flat course's slight
      habitat slope. The test pad grew into a dev-only `?axisRamp` ramp
      from the Starter Course to a pad 500 m from the axis and on to the
      axis itself. Derivation v5 counts shock tilt; every official shock
      leans 30° on coilover versions rated for it, so wheel rates and travel
      are unchanged, with deep hinge-pin mounts and post-and-crossbar towers.
      The taller towers and longer plates shift stats slightly: acceleration
      Balanced 42→41, Speed 10→9, Handling 79→76; stability Speed 46→44,
      Handling 87→76.
      Manual righting now clears the hull through the whole roll. After
      merge, re-save and republish the three official karts in production
      (Load official design, Save, Publish).
- [ ] 4.3.3: Course loading screen showing Island Three from outside in
      space, held for a short minimum. Debrief whether Saturn appears and
      whether the home screen shares the backdrop. Also fix the `home.spec`
      test "recovers at the latest supported checkpoint and pauses
      stabilization", which fails on `main` (found in PR 4.3.2): the race is
      already racing when the test expects the countdown.
- [ ] 4.3.4: Distant structures: a few large landmark structures and
      clusters of buildings across the valleys, so the enclosure reads with
      height rather than as flat ground. Code-built and within the phone
      budget. Consider a waterfall off an end-cap terrace whose falling water
      bends anti-spinward with Coriolis, as the spin demands: about 40 m of
      drift over a 200 m drop (feature lead idea from PR 4.3.2).
- [ ] 4.3.5: Dusk and night: the haze and habitat light dim as the mirrors
      close, as O'Neill's habitat makes night. Then course lamps (up to four
      point or spot lights with visible full-size masts, seeded on the
      Agricultural Zone), lights in the distant villages and roads, and a
      decision on lamp shadows, which the budget's one shadow-casting light
      does not yet allow. Also chase the sun-shadow flicker on kart and wall
      shadows seen on iPhone in PR 4.3.2 QA; it may predate that PR, whose
      camera now follows habitat up.

**PR 4.4: Agricultural Zone Service Circuit** (split by route section)

Route beats:

1. Starting service lane.
2. Tight hydroponic rows.
3. Narrow irrigation tunnel.
4. Glass canopy or habitat vista.
5. Maintenance ramp or drop.
6. Return lane through floor-marked service infrastructure.

- [ ] Two-lap route following those beats, authored under `agricultural-zone`.
- [ ] Scale language: oversized crop trays, pipes, vents, doors, rails, ramps,
      and catwalks that make the karts feel tiny.
- [ ] A jump that shows the spin's effect on a flying kart.
- [ ] Habitat vistas that show the cylinder's curvature.

**PR 4.5: Ambience and SFX**

- [ ] Ambience and readable SFX for road contact, impacts, machinery,
      irrigation, and the habitat, kept separate from kart physics.

**Done when:**

- Two laps take roughly 90 seconds to 2.5 minutes, and the handling feels like
  fast RC arcade racing: quick acceleration, tight steering, slight controlled
  drift, forgiving walls, fast reset. Easy to finish, hard to master.
- Karts, sandbox, enclosure, and course read as one visual identity and stay
  within the phone performance budget.
- Every physics change is versioned, and older runs keep their physics
  version.

### Phase 5: Solo, Ghosts, Results, Leaderboard

**Goal:** make solo play replayable.

- [ ] Solo time trial with developer and player-best ghosts.
- [ ] Result screen showing total and lap times, kart used, replay, sharing,
      and a login prompt when the run is leaderboard-eligible.
- [ ] Player login with explicit account linking, including SIWE wallet login
      that never becomes the canonical user ID.
- [ ] Login-gated global solo leaderboard. Official karts are eligible;
      community karts stay casual until their balance is validated.
      Multiplayer results stay room-only.
- [ ] Progression tiers from Agricultural Zone best-time medals: a finish tier,
      then bronze, silver, and gold. Tiers do not unlock kart-assembly parts.
- [ ] Guests keep racing freely without progression.
- [ ] Races and results record the course ID and immutable publication revision
      instead of hard-coding the official course.

Wallet scope is login and account linking only. Embedded wallets, balances, and
on-chain actions need a separately accepted scope.

**Done when:** medal tiers are granted once per player and cannot be forged by
client state.

### Phase 6: Community Karts And Structural Breakage

**Goal:** every logged-in player can build, publish, and race karts, and karts
can break in a readable, forgiving way.

Reuse the Phase 3 kart document, derivation, editor, and revision pipeline. No
second format, raw tuning, or creator-set stat or joint-strength numbers.
Publishing is immediate, with no approval queue.

**PR 6.1: Player kart ownership and publishing**

- [ ] Role-aware player kart editor without admin or roster controls.
- [ ] Players create, edit, and save only their own private drafts.
- [ ] Swapping a suspension type keeps the current arm geometry. Approved
      mounting defaults assume 8 cm arms, so on the official karts' longer
      arms the hub lands off the wheel (deferred from PR 4.1.4).
- [ ] Debrief speed-carrying drifts: a handbrake drift should flow on out of
      the corner, but sliding asphalt grip scrubs most of the speed. Options
      to weigh: a drift tire with lower sliding grip, a wheel-spin model, or
      an explicit assist (deferred from PR 4.2.6).
- [ ] Owners publish validated revisions immediately and unpublish their own
      karts while keeping history and attribution.
- [ ] Server-side ownership checks, validation, bounded text and parts,
      server-owned derivation, the approved part catalog, and publish rate
      limits. Guests cannot author or publish.
- [ ] Mark official vs. community karts with a server-owned field instead of
      relying on which admin saved first or on client-chosen IDs.
- [ ] Send `no-store` on every admin and profile response, cap JSON request
      sizes, and restrict or server-render thumbnail PNG chunks.

**PR 6.2: Community kart discovery, play, and safety**

- [ ] Public catalog that clearly separates official and community karts.
- [ ] Anyone can race any published community kart in casual modes.
- [ ] Each race records the kart ID and publication revision.
- [ ] Admins feature or safety-unpublish karts without changing stats,
      eligibility, history, or audit data. Unpublished karts leave discovery
      and guest play.

**PR 6.3: Structural joints and forgiving breakage**

- [ ] Research and approve the damage standard and its PlayCanvas/Ammo mapping
      first.
- [ ] Add versioned joints between parts to the kart document without breaking
      older revisions, validate structural coherence, and upgrade the three
      official karts the same way.
- [ ] Derive joint strength from part roles, mass, geometry, and placement.
- [ ] Derive impact severity from mass, contact velocity, contact normal, and
      angle of attack. Severe wall, obstacle, or fall impacts detach parts
      deterministically.
- [ ] Ordinary contact stays forgiving, and the kart always keeps a drivable
      core.

**Done when:**

- Players can create, publish, revise, and unpublish only their own karts;
  cross-owner and admin-only actions are blocked.
- Guests can race a published community kart, and community karts cannot reach
  the solo leaderboard.
- A race stays bound to the kart revision it started with.
- Glancing hits, direct hits, scraping, repeated small hits, and falls behave
  forgivingly, and detached parts clean up correctly on reset and race finish.

Not in this phase: external assets, marketplace behavior, collaborative editing,
comments, and leaderboard eligibility for community karts.

### Phase 7: Community Courses

**Goal:** players publish, discover, race, and curate courses with no approval
queue.

Reuse the existing course document, revisions, and editor. No second format or
editor. The Starter Course (`rough-course`) is the template new community
courses start from.

**PR 7.1: Player course ownership and publishing**

- [ ] Role-aware player course editor without admin-only controls.
- [ ] Players create, edit, and save only their own private drafts.
- [ ] Swapping a suspension type keeps the current arm geometry. Approved
      mounting defaults assume 8 cm arms, so on the official karts' longer
      arms the hub lands off the wheel (deferred from PR 4.1.4).
- [ ] Owners publish validated revisions immediately and unpublish their own
      courses while keeping history, attribution, and past race identity.
- [ ] Server-side ownership checks, validation, bounded text, and publish rate
      limits. Guests cannot author or publish.

**PR 7.2: Public course discovery and play**

- [ ] Public catalog separating the official circuit from community courses,
      with featured, popular, and new views.
- [ ] Anyone can launch a published course, and each race records the course ID
      and publication revision.
- [ ] Remove rough-course and Agricultural Zone assumptions from shared race
      systems while keeping official-course selection and recovery working.

**PR 7.3: Ranking, featuring, and safety**

- [ ] One reversible thumbs-up per player per course. No downvotes or star
      ratings.
- [ ] Admin featuring stays separate from thumbs-up counts and ranking.
- [ ] Admins safety-unpublish courses without deleting history or audit data.
      Unpublished courses leave discovery and guest play.

**Done when:** players can manage only their own courses, publishing needs no
approval, races stay bound to their starting revision, featured, popular, and
new views stay distinct, and authoring and discovery work on narrow screens.

Not in this phase: custom course assets, collaborative editing, comments, and
course-specific ghosts or leaderboards.

### Phase 8: Private Multiplayer

**Goal:** make the demo social, with kart-to-kart contact handled by one
authoritative system.

**PR 8.1: Private rooms and race lifecycle**

- [ ] Create a private room and join by link; 2–4 players, guests welcome.
- [ ] Choosing a kart marks a player ready; the host starts a synchronized
      countdown.
- [ ] Opponents are visible with coherent race progress.
- [ ] Synchronized results with placements, and replay in the same room. The race ends when all
      active players finish or shortly after the first finisher.
- [ ] No public matchmaking or ranked multiplayer leaderboard.

**PR 8.2: Motion and resilience**

- [ ] Define server authority, update cadence, prediction, interpolation,
      reconciliation, and bounded correction.
- [ ] Keep remote presentation separate from authoritative race, collision, and
      damage state.
- [ ] Survive latency, packet loss, reordering, backgrounding, disconnects,
      reconnects, and host departure without hanging the room.
- [ ] Keep all input methods, reset, pause, and resilience behavior working.

**PR 8.3: Collisions and damage sync**

- [ ] Resolve each kart-to-kart contact once, authoritatively, using both karts'
      mass, relative velocity, contact normal, and angle of attack.
- [ ] Sync collision impulses, joint damage, and detached parts through the
      Phase 6 structural model, including contact that coincides with an
      environment impact.
- [ ] Prevent remote tunneling, explosive corrections, duplicate damage, and
      diverging detached parts, while keeping damage forgiving.

**Done when:** a host creates a room, a guest joins by link, both ready up and
race, and results resolve without hanging; the room can replay; and rubbing,
glancing, rear-end, head-on, pileup, airborne, wall-pinning, and concurrent
kart/environment contacts each resolve once with damage that stays in sync under latency and disconnects.

### Phase 9: Public Demo Polish

**Goal:** make it ready to share.

- [ ] Controller polish.
- [ ] Result sharing.
- [ ] Mobile performance pass.
- [ ] Lobby polish, onboarding copy, and UI clarity.
- [ ] Final visual pass against the Titan Racers site.
- [ ] Analytics review: confirm we can measure time to first race, race start
      and completion, replays, room joins, shares, login after a race,
      leaderboard submissions, community publishing and play, thumbs-ups,
      controller use, and where players drop off.

When Demo v1 is accepted, delete this plan.
