# Titan Racers Demo v1 Implementation Plan

Titan Racers is a browser-playable demo built to prove one idea:

> Race tiny buildable karts through forbidden service routes inside humanity's
> last Titan colony.

Demo v1 is done when solo racing on three official courses, official and
community karts built from primitives, ghosts, leaderboard-ready results,
CAD-style kart assembly with remixes and tracked royalties, community kart and
course publishing, private multiplayer, and controller support all work.

This file is the source of truth for remaining scope. Delete it once Demo v1 is
accepted; the app, README, and durable docs take over from there.

## Status

- **Done:** Phases 0–6 (PRs #1–#24, the Phase 3 closeout and its
  follow-ups, #30–#57 with the PR 4.5.2 closeout, #59–#63, and #64–#70
  with the Phase 6 closeout), and the addendum's PRs 6.7 (#71) and 6.8
  (#72).
- **Now:** the [Phase 6 addendum](#phase-6-addendum-feedback-before-phase-7),
  PR 6.9.
- **Next:** Phase 7, after its debrief.

## Guiding Decisions

These still constrain every remaining phase.

- **Racing feel comes first.** The core is a fun two-lap RC-style race.
- **Karts are machines, not skins.** Behavior comes from validated construction
  through a versioned derivation. There are no manual stat overrides; if a
  reasonable build behaves badly, fix the editor, parts, derivation, or physics.
- **Three layers: racing, assembling, engineering.** Demo v1 covers racing and
  assembling: players assemble approved parts, and only admins engineer them.
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
  now; every logged-in player gets the same tools in Phase 9.
- **Kart cards stay practical.** Short machine-focused descriptors, no lore.
- **Match the existing Titan Racers site** (see [Visual Direction](#visual-direction)).
- **Ship separately from the marketing site,** likely at `play.titanracers.com`.

## Stack

- **App shell:** Next.js (React) for mode and kart selection, auth, authoring,
  results, leaderboards, community catalogs, rooms, sharing, and analytics.
- **Game runtime:** PlayCanvas with Ammo physics, chosen in the Phase 1 spike.
- **Data:** Postgres locally and Neon when hosted, with Drizzle migrations.
- **Auth:** Better Auth with Postgres-backed sessions. Players and admins log
  in with Google; SIWE wallet login and account linking arrived in Phase 5,
  with Better Auth's SIWE plugin and signatures checked offline by `viem`. The
  first admin is bootstrapped by a database script
  (`docs/database-operations.md`).
- **Analytics:** Vercel Web Analytics for anonymous page views, plus small
  gameplay-run summaries in Postgres with an admin dashboard.
- **Assets:** karts and courses are bounded primitive documents, so no file
  storage is needed. Textures and models are reviewed repository assets that
  ship with the app (see Completed Phases). Add a reviewed S3-compatible boundary only
  if player uploads arrive after Demo v1.
- **CAD authoring:** text-to-cad for admin part models, used only in
  development and never in the app runtime (Phase 7).
- **Multiplayer transport:** Cloudflare Workers with a Durable Object per
  room over WebSockets (Phase 6), deployed apart from the app.

## Scope

### In Demo v1

- Mobile-friendly web app with fast guest entry into racing.
- Three official courses that move from rural to town to city: the Falls
  View Park Circuit, then one in Phase 8 and one in Phase 10.
- Two-lap solo time trial with a result screen after every race.
- Three official karts (Balanced, Speed, Handling) with distinct handling, each
  showing name, assembler credit, visual identity, stat bars, and a short
  descriptor.
- Keyboard, touch, and gamepad controls, plus fast reset.
- Own-best, course-best, and shared ghosts.
- Login-gated solo leaderboard.
- Gold, silver, and bronze for each official course board's top three.
- Admin kart builder; from Phase 9, player-built community karts with
  immediate publishing, discovery, and admin safety unpublishing.
- CAD-style kart assembly, kart remixes, and assembler royalties that are
  tracked and displayed, never paid.
- Player-built community courses with immediate publishing, thumbs-ups, admin
  featuring, and safety unpublishing.
- Private 2–4 player multiplayer rooms that guests can join by link.
- Basic analytics to learn whether the demo is fun.

### Not In Demo v1

- External model or custom asset uploads.
- Marketplace, patenting, royalty payments, or a deep economy.
- Player component engineering.
- On-chain gameplay or token rewards.
- Global ranked multiplayer or robust anti-cheat.
- Hand-finished production art or a real-world kit export pipeline. Phase 4
  set a demo-sized visual baseline instead.
- Damage beyond the simple joint-breakage model in Phase 9.
- Fuel or battery simulation, advanced tire physics, or punishing collisions.
- Player-editable numerical tuning or raw handling controls.

## Roles

| Role | Can do |
| --- | --- |
| Guest | Race official and published community karts and courses, join private rooms, see local results. Cannot submit leaderboard times or save designs. |
| Player | Signs in with Google, a wallet, or a passkey, or starts a racer kept in one browser. Everything a guest can, plus a persistent racer identity and history, leaderboard submission, building, remixing, and publishing their own karts (Phase 9) and courses (Phase 11), and one thumbs-up per community course. |
| Admin | Protected course and kart editors; create, revise, publish, and unpublish official karts and courses; feature or safety-unpublish community karts and courses without deleting history; inspect derived kart stats, never override them. Several admins are allowed. |

## Visual Direction

Match the current Titan Racers site: near-black base, ice text, orange and
hazard-yellow signals, steel-blue technical accents, Arial/Helvetica-style sans,
Courier-style mono labels, bold uppercase headings, widely tracked operational
labels, sharp industrial borders, and restrained panels.

The HUD should feel like a racing operations interface, not a lore panel or a
neon arcade skin. Multiplayer is called "Multiplayer" everywhere a player
sees it.

## How We Work

- **Process:** `docs/session-workflow.md` covers debriefs, approvals, commit
  gates, independent review, and the integration review that closes each
  multi-PR phase. `docs/pr-review-workflow.md` covers PR feedback.
- **PR numbering:** `PR <phase>.<n>`, or `PR <phase>.<stage>.<n>` when a phase
  needs stages. A PR's number never changes once work on it begins.
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
| 4. Visual baseline, Island Three, and Falls View Park | One shared kart visual builder, a lighting baseline and phone budget, and presentation-only part visuals; sandbox surfaces with grass physics, substepped high-speed collisions, and tire marks and clippings; the Island Three enclosure with true-scale rotating-habitat physics, a loading screen, valleys, and dusk; the Falls View Park Circuit, built section by section and published; generated race audio, kart sound, race cues, and lean ambience, with CC0 recordings where synthesis did not read; the kart editor's suspension swap; integration review. | #30–#57, closeout |
| 5. Solo, ghosts, results, leaderboard | Races record their course and kart revisions; one see-through ghost recorded at 20 Hz, from your device, the course best, your account best, or a friend's link; Google plus SIWE wallet login and account linking; signed run tickets and server-verified runs, a best and its ghost per racer per board, and a leaderboard with podium medals; a guest's run kept until they sign in, link copying, and ghost links by username; a Phase 5 dashboard panel; a step-by-step home with keyboard, touch, and controller navigation, course pictures, menu sounds and one Volume, the levee kicker, and link preview cards; integration review. | #59–#63 |
| 6. Private multiplayer | Leaderboards across course publications, with earlier versions kept; a clearer admin dashboard; accounts kept in a browser, passkeys, and sign-in rate limits; bringing a browser's account into another; private rooms of up to 4 on Cloudflare Durable Objects, with a lobby, one room clock, results, and Race again; opponents drawn smoothly through lateness, with their sound, and races that survive dropped connections; kart-to-kart contact answered at once on each page and recorded once by the room; Multiplayer on home's first screen; integration review. | #64–#70 |

Decisions from completed phases that later phases rely on:

- `rough-course` is the permanent editor and physics sandbox. Official courses
  use their own course IDs (Falls View Park's is `falls-view-park`,
  `agricultural-zone` until PR 4.3.4), and publishing or guest play must never
  mix them with the sandbox.
- Gameplay telemetry stays small: one summarized record per run, with no raw
  input, per-frame, hardware-identity, or player-journey capture.
- Course revision history and restore, real-time collaboration, and multi-author
  merging are later tooling, not Demo v1.
- **One visual identity and one phone budget.** `docs/visual-identity.md`
  owns the art direction and the budget (CPU median ≤ 5 ms on the lead's
  iPhone, measured with `?perf=1` on a production build); every later phase
  holds it. With sound on, the closed Phases 4 and 5 measured 3.0 / 4.0 ms,
  and Phase 6's two-player room with contact 3 / 6 ms.
- **Karts are 1:10 RC scale.** Part visuals are presentation only and never
  change derivation, revisions, or hashes.
- **Assets are code-built geometry, CC0 textures and sounds, and
  repository-owned models,** all reviewed and committed; players cannot
  upload assets.
- **Island Three is the enclosure for every course,** and courses name their
  enclosure and placement. Physics is true-scale rotating-habitat gravity and
  Coriolis under versioned physics; low-gravity racing belongs to Phase 8's
  or Phase 10's course.
- **Race sound is one-way from physics.** Sound is generated with Web Audio,
  and CC0 recordings are used where synthesis does not read. A kart's voices
  are the motor, tire roll, and scrub (16 nodes each) and a body scrape (5),
  with one-shots of at most 8 nodes; Phase 6's remote karts can run a
  cheaper motor and tire-roll voice.
- **Solo results are verified, not cheat-proof.** A board covers a course's
  publications from one that starts a new leaderboard to the next, under one
  physics version, with one best (and its ghost) per racer (PR 6.0). The
  server times a run
  from its own check of the recording against a signed, single-use ticket;
  the client never sends a time, rank, or medal. Only a logged-in racer with
  a username, in an official kart, on a published revision under the current
  physics, is eligible; community karts stay casual and multiplayer results
  stay room-only. Medals are the board's current top three, display-only and
  never stored. Runs through the storm drain stay eligible because gates
  count only in order and its chute is the only way back in; re-check if a
  course change opens another way back in.
- **Ghosts are 20 Hz recordings, one on track at a time,** never telemetry
  and never re-simulated; only a racer's best per board keeps one on the
  server. Ghost links name a public username, never an ID, and race that
  racer's best on the current board. Replay is Race again with a ghost;
  there is no watch mode.
- **Login is Google, SIWE browser wallets** (EIP-6963, messages naming
  Base, chain 8453), **and passkeys** (PR 6.2). Racers link methods
  explicitly; email never links accounts, accounts merge only when a racer kept
  in one browser is brought into another (PR 6.3), and the last method
  cannot be unlinked.
  WalletConnect, smart-contract wallets, ENS, embedded wallets, balances, and
  on-chain actions need a separately accepted scope.
- **Guests race freely without progression, or start a racer kept in this
  browser** (PR 6.2): a full racer, with no login method until they add a
  passkey, Google, or a wallet, and warned until then that clearing the
  browser or switching devices loses it for good. A guest's qualifying run
  waits on the device and joins the board as theirs if they sign in (starting
  a racer on this browser counts) and have a username within 30 minutes of
  its start.
- **Accounts kept in a browser are lasting IDs** (Better Auth's anonymous
  user, with its merge-and-delete off), and can be brought into an account
  you sign in to, which keeps everything (PR 6.3); accounts with login
  methods never merge, and one that owns karts or courses can't be brought
  in, so Phases 9 and 11 revisit that. Sign-ins are rate limited in
  Postgres. Usernames stay fixed for now, never called permanent; a rename
  PR must lift migration 0012's trigger and keep old names reserved.
- **A room server decides; each page drives its own kart** (Phase 6). The
  [multiplayer rooms system](skills/project-systems/multiplayer-rooms/README.md)
  owns rooms on Cloudflare Durable Objects: membership and host, kart
  choice, one clock, each kart timed from its own checked states, results
  stored without account IDs and kept off leaderboards, and the record of
  each kart-to-kart contact. Opponents are drawn and estimated, never
  simulated, and contact follows the
  [kart-to-kart contact standard](skills/game-concepts/kart-to-kart-contact/README.md):
  each page answers its own kart at once, and the room records each touch
  once, the record Phase 9's damage extends.
- **One room protocol version is live at a time,** raised for each change
  to its messages (3 after Phase 6): deploy the room server just before the
  app's PR merges, with no race running. Rooms stay on Cloudflare's Free
  plan until a shared demo; before any shared link, move to Workers Paid
  with the protections Phase 12 lists.
- **Home is a step-by-step flow**, one history entry a step, with no Quick
  race, and menus sound on every action except in the admin tools. Its
  first screen offers Time Trial, Multiplayer, and Leaderboard (PR 6.6). A
  time trial goes on to the kart, course, and ghost; Multiplayer opens a new
  room, where each racer chooses a kart and the host the course (only Falls
  View Park so far).
- **Component engineering is a separate later phase.** Kart assembly uses
  sealed, freely available parts with no progression tiers. If component
  engineering is planned, progression unlocks engineered *parts*, an engineered
  component's tier is the highest tier among its parts, and neither tiers nor
  stats can be overridden.

## Remaining Phases

### Phase 6 Addendum: Feedback Before Phase 7

**Goal:** act on playtest feedback before Phase 7. The addendum gets its own
integration review, from `2ffc5a20` (PR #70), before its last PR merges.

**PR 6.7: Touch selection and the plan addendum**

- [x] Pressing or holding anywhere on a race screen never selects text,
      opens the long-press menu, or zooms. Text boxes still select and paste.
- [x] Two more official courses join the plan (Phases 8 and 10).

**PR 6.8: Fastest lap**

- [x] The server finds each lap in its check of a run's recording and keeps
      the run's fastest lap.
- [x] The leaderboard lists each account's best race, ranked by Total time
      or by that race's Fastest lap, each showing the other as a second
      line. Medals stay with total time.
- [x] The result screen marks the race's fastest lap.
- [x] The pause menu can restart a solo race from a fresh countdown.
- [x] Existing bests get their fastest lap from their kept recordings, once,
      when the migration reaches production.

**PR 6.9: Course interactables, starting with the utility-tunnel door**

- [ ] A standard for course objects that change state during a race,
      built to serve later interactables, with notes on the engine's hinges
      and breakable latches.
- [ ] Door 4 of the utility tunnel becomes a real steel door of about
      40 kg on its hinge, held by a worn latch that a square hit at about
      7 m/s (25 km/h) breaks. It swings into a small store room under the
      berm behind the tunnel wall. A push, or a hit near the hinge, never
      opens it. The other doors stay painted.
- [ ] The room's light comes on when the door opens, the latch clacks, and
      the door thuds on its stop. A course may have 24 indoor lamps.
- [ ] The room's contents and its poster of The Lady Lucky, a homebuilt
      spacecraft for homesteading, are a Claude-vs-Codex contest: each
      builds both to one brief, the lead judges blind from the same three
      renders after a cross-critique, and poster and room are judged
      separately. The poster is drawn by code, at A1.
- [ ] The door closes at each race start, Restart, and Race again, never on
      a kart's reset. Ghosts drive through it.
- [ ] In a room (protocol 4), the opener's page opens the door at once and
      tells the room, which keeps the race's first opening if the opener
      was within about 1.5 m of the door, and tells everyone. Other pages
      open it when they see the opener reach it, and a returning page finds
      it open.
- [ ] The room leads nowhere, so the run check, gates, recordings, and
      leaderboard are unchanged: the course's new revision publishes with
      New leaderboard off.

**Exploration, no PR: contrast and a more distinctive look**

- [ ] Draft two or three directions for more contrast and a less generic
      look, and compare them before anything is built. Any of this may be
      dropped. "Match the existing Titan Racers site" holds unless an
      accepted direction changes it.

**PR 6.10: Home and the main site**

- [ ] Replace home's AI-generated background and bring home closer to the
      game's look, with whatever the exploration accepts.
- [ ] Update the main Titan Racers site to match. Where it lives is settled
      at the debrief.

**PR 6.11: Filling the park**

- [ ] Claude and Codex each build park furniture and planting (benches,
      other trees, bushes, flowers) for in and around the course, then judge
      each other's work under rules agreed at the debrief.
- [ ] Everything stays within the phone budget.

**Done when:** races on a phone can't select or zoom the page; the fastest lap
shows; the tunnel door opens the same way for every racer in a room; home, the
main site, and the park reflect the accepted look; and the addendum's
integration review is resolved.

### Phase 7: CAD Assembly And Kart Royalties

**Goal:** make kart assembly feel like CAD, rebuild selected approved parts with
new authoring approaches, and credit assemblers with tracked, displayed
royalties.

Phase decisions:

- **Racing and assembly only.** Players assemble approved parts and engineer
  nothing. Only admins engineer parts, and the component-engineering boundary
  in `docs/kart-system/components-and-materials.md` still holds.
- **CAD stays out of the game.** text-to-cad (build123d on OpenCASCADE) is an
  admin authoring tool used only in development, never in the app runtime.
- **Royalties are tracked and displayed, never paid.** Payments, balances, and
  on-chain actions need a separately accepted scope.

**PR 7.1: Admin parts with new approaches**

- [ ] Review text-to-cad and set it up for development only: telemetry off,
      no installer that configures every agent app, and a license check
      before committing any vendor model from `step.parts`.
- [ ] Rebuild selected approved parts' visuals from CAD models, or from
      code-built linkages posed from one input. Visuals stay presentation-only,
      so derivation, revisions, and hashes do not change; mass measured from
      CAD enters only through new part versions.
- [ ] A per-kart triangle and draw budget for part visuals that keeps a
      four-kart room within the phone budget.

**PR 7.2: CAD-style assembly**

- [ ] Approved parts declare named mounting points, and compatible parts snap
      together. New kart schema version; older revisions load unchanged.
- [ ] Clearance and interference checks from measured overlap and closest
      points between parts.
- [ ] Exploded and x-ray views, with suspension posed from wheel travel, and
      measured-dimension readouts. Presentation only.
- [ ] Ships in the admin kart builder; players get it in Phase 9.

**PR 7.3: Assembler credit and royalties**

- [ ] Each published kart revision records its assembler and license terms:
      whether others may race and remix it, and a payment type of
      attribution or free.
- [ ] A server-owned ledger counts races, room uses, and remixes for each
      published kart, computed from the race results and kart revisions that
      Phases 5 and 6 record, with no new telemetry. Kart cards and assembler
      profiles show it.
- [ ] Official karts come first; community karts and remixes join in Phase 9.

**Done when:** a rebuilt part shows on every kart that uses it without changing
any derived stats, within the phone budget; karts assemble by mounting points
with clearance checks, and older revisions still race unchanged; and each
published kart shows its assembler, license, and usage, with nothing paid out.

References (concepts, not dependencies):

- [text-to-cad](https://github.com/earthtojake/text-to-cad) (MIT): agents
  write build123d models; mass from volume times density; overlap and
  closest-point checks; STEP, GLB, STL, and 3MF export.
- [SindriCAD](https://tinkeratlas.com/sindricad) (AGPL-3.0, concepts only):
  documents store the recipe (named parameters and ordered features), not
  the shapes.
- [RSL 1.0](https://rslstandard.org/): per-asset license terms, what is
  permitted or prohibited, and a fixed set of payment types.
- [teardown](https://github.com/elvarofficial/teardown) (MIT): one input drives
  every pose; isolate, x-ray, cut away, or explode the part doing the work.

### Phase 8: Second Official Course

**Goal:** a second official course, in a village or town, between Falls View
Park's rural parkland and Phase 10's city.

- [ ] Debrief its site in Island Three, its route, and its layout at kart
      scale before building.
- [ ] Decide whether this course or Phase 10's shows lower gravity. One of
      them must. Gravity falls with distance from the axis: the end-cap
      terraces top out at 0.7 R (about 0.7 g), so clearly low gravity means
      a course near the hub. Either needs the placement rules in
      `docs/island-three.md`, which keep courses clear of the caps and the
      axis, to change.
- [ ] Remove rough-course and Falls View Park assumptions from shared race
      systems while keeping official-course selection and recovery working,
      and let a room's host pick either official course.

**Done when:** the second course is published, races two laps solo and in a
room, has its own leaderboard, and holds the phone budget.

### Phase 9: Community Karts And Structural Breakage

**Goal:** every logged-in player can build, publish, and race karts, and karts
can break in a readable, forgiving way.

Reuse the Phase 3 kart document, derivation, editor, and revision pipeline. No
second format, raw tuning, or creator-set stat or joint-strength numbers.
Publishing is immediate, with no approval queue.

**PR 9.1: Player kart ownership and publishing**

- [ ] Role-aware player kart editor without admin or roster controls.
- [ ] Players create, edit, and save only their own private drafts.
- [ ] A racer kept in one browser that owns a kart can't be brought into
      another (PR 6.3): decide whether a merge moves its karts.
- [ ] Players assemble with Phase 7's CAD-style tools.
- [ ] Players remix a published kart whose license allows it: the draft starts
      from that revision, and the published remix credits the original
      assembler and links its source revision.
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

**PR 9.2: Community kart discovery, play, and safety**

- [ ] Public catalog that clearly separates official and community karts.
- [ ] Anyone can race any published community kart in casual modes.
- [ ] Players can bring a published community kart into a private room.
- [ ] Community karts' races, room uses, and remixes count in the Phase 7
      ledger.
- [ ] Admins feature or safety-unpublish karts without changing stats,
      eligibility, history, or audit data. Unpublished karts leave discovery
      and guest play.

**PR 9.3: Structural joints and forgiving breakage**

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
- [ ] Sync joint damage and detached parts through the Phase 6 authority,
      including contact that coincides with an environment impact, with no
      duplicate damage or diverging detached parts.

**Done when:**

- Players can create, publish, revise, and unpublish only their own karts;
  cross-owner and admin-only actions are blocked.
- Guests can race a published community kart, and community karts cannot reach
  the solo leaderboard.
- A race stays bound to the kart revision it started with.
- A remix credits its source kart's assembler and keeps its source revision.
- Glancing hits, direct hits, scraping, repeated small hits, and falls behave
  forgivingly, detached parts clean up correctly on reset and race finish,
  and damage stays in sync in rooms under latency and disconnects.

Not in this phase: external assets, marketplace behavior, collaborative editing,
comments, and leaderboard eligibility for community karts.

### Phase 10: Third Official Course

**Goal:** a third official course, in a city, after Phase 8's town.

- [ ] Debrief its site, route, and layout at kart scale before building.
- [ ] Show lower gravity, unless Phase 8's course already does.

**Done when:** the third course is published, races two laps solo and in a
room, has its own leaderboard, and holds the phone budget.

### Phase 11: Community Courses

**Goal:** players publish, discover, race, and curate courses with no approval
queue.

Reuse the existing course document, revisions, and editor. No second format or
editor. The Starter Course (`rough-course`) is the template new community
courses start from.

**PR 11.1: Player course ownership and publishing**

- [ ] Role-aware player course editor without admin-only controls.
- [ ] Players create, edit, and save only their own private drafts.
- [ ] A racer kept in one browser that owns a course can't be brought into
      another (PR 6.3): decide whether a merge moves its courses.
- [ ] Owners publish validated revisions immediately and unpublish their own
      courses while keeping history, attribution, and past race identity.
- [ ] Server-side ownership checks, validation, bounded text, and publish rate
      limits. Guests cannot author or publish.
- [ ] A per-course budget for generated geometry: elbows, handwheels, bevels,
      signs, and timber each build their own mesh, so 5,000 of them could
      exhaust a phone.
- [ ] Let authors create what the seeds use: crowd barriers, signs, bevels,
      handwheels, elbows, bicycles, and a clearing's footprint have no
      preset or inspector field yet, and the editor cannot duplicate.

**PR 11.2: Public course discovery and play**

- [ ] Public catalog separating the official courses from community courses,
      with featured, popular, and new views.
- [ ] Anyone can launch a published course, and each race records the course ID
      and publication revision.
- [ ] A host can pick a published community course for a private room.

**PR 11.3: Ranking, featuring, and safety**

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

### Phase 12: Public Demo Polish

**Goal:** make it ready to share.

- [ ] Controller polish.
- [ ] Mobile performance pass.
- [ ] Lobby polish, onboarding copy, and UI clarity.
- [ ] Final visual pass against the Titan Racers site.
- [ ] Ambience left from Phase 4: machinery at Falls View Park's valve and
      junction kits, and sprinkler or drip irrigation over the nursery rows,
      within the phone budget.
- [ ] Loose ends from Phase 4: the junction chamber's valve risers have no
      collision, and tests fail on `main` on the lead's server under
      software WebGL: four in `home.spec` ("keeps a late thumbnail fallback
      isolated from race startup", "keeps the drive cursor hidden and
      restores it while paused", "recovers a lost WebGL context into an
      explicit pause…", and "navigates guest menus end-to-end with a
      standard controller snapshot") and two in `gameplay-telemetry.spec`
      ("flushes one coarse health summary…" and "reports ordered run
      milestones…", which time out clicking Exit). Three more in
      `home.spec` failed there in Phase 6, on `main` too: "releases a
      thumbnail pause when home unmounts during queue drain", "keeps the
      rough-race HUD clear of mobile utilities", and "launches the slowest
      and fastest karts off the levee kicker onto the crest". Serial
      groups skip the tests after a failure, so fix these first.
- [ ] Before any shared room link (Phase 6's integration review): Workers
      Paid, a rate limit on the room token route, and rooms on the custom
      domain behind a rate-limiting rule, so a script can't spend the
      day's room budget.
- [ ] Left from Phase 6's integration review:
      - security: removing a login method needs a recent session when
        another remains; prune old rows from `rate_limits`; send
        `/room/[code]` to analytics without the code; admin routes log only
        an error's name and code;
      - rooms: a Try again button on "Refresh to…" messages; "(left)" for
        screen readers in the standings; say a race ended while you were
        reconnecting rather than that it was called off; one Back label;
      - accounts: an "Already have an account?" sign-in from a mistaken
        Continue anonymously, and passkey and wallet sign-in for admins;
      - cleanup: one copy of the room code's vector and quaternion helpers,
        and one Node room test client;
      - tests: a second race in the same room, a kart pinned against a
        wall, and the 9 ms contact step on the iPhone.
- [ ] Analytics review: confirm we can measure time to first race, race start
      and completion, replays, room joins, shares, login after a race,
      leaderboard submissions, community publishing and play, thumbs-ups,
      controller use, and where players drop off.

When Demo v1 is accepted, delete this plan.
