# Titan Racers Demo v1 Implementation Plan

Titan Racers is a browser-playable demo built to prove one idea:

> Race tiny buildable karts through forbidden service routes inside humanity's
> last Titan colony.

Demo v1 is done when solo racing, official and community karts built from
primitives, ghosts, leaderboard-ready results, CAD-style kart assembly with
remixes and tracked royalties, community kart and course publishing, private
multiplayer, and controller support all work.

This file is the source of truth for remaining scope. Delete it once Demo v1 is
accepted; the app, README, and durable docs take over from there.

## Status

- **Done:** Phases 0–4 (PRs #1–#24, the Phase 3 closeout and its
  follow-ups, and #30–#57 with the PR 4.5.2 closeout).
- **Next:** PR 5.5, the last of Phase 5. PRs 5.1 (#59), 5.2 (#60), 5.3
  (#61), and 5.4 are done (see Phase 5's decisions).

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
  now; every logged-in player gets the same tools in Phase 8.
- **Kart cards stay practical.** Short machine-focused descriptors, no lore.
- **Match the existing Titan Racers site** (see [Visual Direction](#visual-direction)).
- **Ship separately from the marketing site,** likely at `play.titanracers.com`.

## Stack

- **App shell:** Next.js (React) for mode and kart selection, auth, authoring,
  results, leaderboards, community catalogs, rooms, sharing, and analytics.
- **Game runtime:** PlayCanvas with Ammo physics, chosen in the Phase 1 spike.
- **Data:** Postgres locally and Neon when hosted, with Drizzle migrations.
- **Auth:** Better Auth with Postgres-backed sessions. Players and admins log
  in with Google; SIWE wallet login and account linking arrive in Phase 5,
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
- **Multiplayer transport:** to be chosen in Phase 6.

## Scope

### In Demo v1

- Mobile-friendly web app with fast guest entry into racing.
- One official track: the Falls View Park Circuit.
- Two-lap solo time trial with a result screen after every race.
- Three official karts (Balanced, Speed, Handling) with distinct handling, each
  showing name, assembler credit, visual identity, stat bars, and a short
  descriptor.
- Keyboard, touch, and gamepad controls, plus fast reset.
- Own-best, course-best, and shared ghosts.
- Login-gated solo leaderboard.
- Gold, silver, and bronze for the Falls View Park board's top three.
- Admin kart builder; after Phase 7, player-built community karts with
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
- Damage beyond the simple joint-breakage model in Phase 8.
- Fuel or battery simulation, advanced tire physics, or punishing collisions.
- Player-editable numerical tuning or raw handling controls.

## Roles

| Role | Can do |
| --- | --- |
| Guest | Race official and published community karts and courses, join private rooms, see local results. Cannot submit leaderboard times or save designs. |
| Player | Everything a guest can, plus a persistent racer identity and history, leaderboard submission, building, remixing, and publishing their own karts (Phase 8) and courses (Phase 9), and one thumbs-up per community course. |
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

Decisions from completed phases that later phases rely on:

- `rough-course` is the permanent editor and physics sandbox. The official track
  uses its own course ID, `falls-view-park` (`agricultural-zone` until PR
  4.3.4), and publishing or guest play must never mix the two.
- Gameplay telemetry stays small: one summarized record per run, with no raw
  input, per-frame, hardware-identity, or player-journey capture.
- Course revision history and restore, real-time collaboration, and multi-author
  merging are later tooling, not Demo v1.
- **One visual identity and one phone budget.** `docs/visual-identity.md`
  owns the art direction and the budget (CPU median ≤ 5 ms on the lead's
  iPhone, measured with `?perf=1` on a production build); every later phase
  holds it. With sound on, the closed Phase 4 measured 3.0 / 4.0 ms.
- **Karts are 1:10 RC scale.** Part visuals are presentation only and never
  change derivation, revisions, or hashes.
- **Assets are code-built geometry, CC0 textures and sounds, and
  repository-owned models,** all reviewed and committed; players cannot
  upload assets.
- **Island Three is the enclosure for every course,** and courses name their
  enclosure and placement. Physics is true-scale rotating-habitat gravity and
  Coriolis under versioned physics; near-axis, low-gravity racing belongs to
  a later course.
- **Race sound is one-way from physics.** Sound is generated with Web Audio,
  and CC0 recordings are used where synthesis does not read. A kart's voices
  are the motor, tire roll, and scrub (16 nodes each) and a body scrape (5),
  with one-shots of at most 8 nodes; Phase 6's remote karts can run a
  cheaper motor and tire-roll voice.
- **Component engineering is a separate later phase.** Kart assembly uses
  sealed, freely available parts with no progression tiers. If component
  engineering is planned, progression unlocks engineered *parts*, an engineered
  component's tier is the highest tier among its parts, and neither tiers nor
  stats can be overridden.

## Remaining Phases

### Phase 5: Solo, Ghosts, Results, Leaderboard

**Goal:** make solo play replayable.

Phase decisions:

- **One ghost on track at a time.** A solo trial races the course best (the
  board's first place) by default, or your own best when the board is empty
  or you choose it; a friend's shared ghost is the other option. There is no
  separate developer ghost.
- **Ghosts are recordings, not re-simulations.** A ghost records the kart's
  pose 20 times per race second, plus exact samples at gate crossings and
  resets, in a small versioned binary format. It is not telemetry: on the
  server, only a logged-in player's best run on a board keeps one, replaced
  when they improve. Guests' ghosts stay on their device.
- **Runs are verified, not cheat-proof.** A logged-in player's qualifying run
  submits on finish. The server checks a signed run ticket (used once, with
  real elapsed time at least the race time), re-runs the gate check on the
  recording against that course revision, caps speed, allows jumps only to
  reset points, and takes the time from its own check. The client never sends
  a time, medal, or rank. A forged recording that obeys the checks can still
  pass.
- **Eligibility:** a logged-in player with a username, an official kart, and
  a published course revision under the current physics. Community karts stay
  casual and multiplayer results stay room-only. Runs that leave through the
  storm drain stay eligible: gates count only in order and the drain's chute
  is its only way back in, so the trip is always a detour. Re-check this if a
  course change opens another way back in.
- **Boards and medals:** one board per published course revision and physics
  version, with one row per player and the top 50 shown. Gold, silver, and
  bronze are the board's current first, second, and third places; they are
  display-only, unlock nothing, and are not stored.
- **Login:** Google, plus SIWE login with browser wallets (EIP-6963) that sign
  with their own key; sign-in messages name Base (chain 8453). A new wallet
  creates a racer with a generated ID, and a racer may link several wallets.
  Signed-in racers link a wallet or Google explicitly; email never links
  accounts, accounts never merge, and the last login method cannot be
  unlinked. WalletConnect, smart-contract wallets, ENS, embedded wallets,
  balances, and on-chain actions need a separately accepted scope.
- **Guests race freely without progression.** A guest's qualifying run is
  kept on their device and goes to the board as theirs once they sign in and
  have a username, within 30 minutes of its start.
- **Ghost links** name a racer by their public username, never an ID, and
  race their best on the course's current board whenever opened; anyone can
  race one without logging in, and any racer on the board can be raced from
  its row.
- **Replay** is Race again with a ghost; there is no watch mode.

**PR 5.1: Race identity and ghosts**

- [x] Races and telemetry record the course and kart IDs and their
      publication revisions instead of hard-coding the official course.
- [x] Run summaries record whether a race came from Race again and which
      ghost it raced (none or your own; later PRs add their choices).
- [x] The ghost recording format and recorder.
- [x] One see-through ghost with no collision, sound, or shadow: your best on
      this device, behind a ghost switch.
- [x] The result screen shows the kart used.
- [x] Ghost playback stays within the phone budget (`?perf=1`).

**PR 5.2: Wallet login and account linking**

- [x] Wallet sign-in through Better Auth's SIWE plugin, and our own route to
      link a wallet to the signed-in racer (the plugin's sign-in ignores the
      session).
- [x] Link Google to a wallet-first racer; unlink while another method
      remains.
- [x] The profile lists login methods; anonymization removes wallets.

**PR 5.3: Verified runs, leaderboard, and medals**

- [x] Signed run tickets, submission on finish, and the server checks.
- [x] Results and each player's best ghost per board in Postgres.
- [x] A leaderboard page; logged-in players race their account best, and
      anyone can race the course best.
- [x] Gold, silver, and bronze for the board's top three.
- [x] The result screen shows rank, personal best, and medal.

**PR 5.4: Results flow and sharing**

- [x] A login prompt on a guest's qualifying result, and claiming the run after
      Google or wallet login, including onboarding.
- [x] Sharing through the share sheet, else copying. A logged-in player's best
      race shares a ghost link that follows their current best.
- [x] Anyone can race a shared ghost from its link without logging in.
- [x] Run summaries record whether the result was shared. A Phase 5 panel on
      the admin dashboard shows replays, ghost use, sign-ups by login method,
      submissions, claims after a race, shares, and races from shared links.
      Sign-ups, submissions, and claims come from the rows those features
      already store, not new telemetry.

**PR 5.5: Home-to-race flow and polish**

- [x] Replace the one-page home with a step-by-step flow: Race or the
      leaderboard first, then the kart, then the course, then the mode and
      whether to race a ghost, with keyboard, touch, and controller
      navigation throughout. Each step is a history entry, so back goes back
      a step. There is no Quick race, so players try different karts, and
      the `rough-course` sandbox stays out of the course choice.
- [x] Course thumbnails for the course choice.
- [x] Sound effects on UI buttons across the app (admin tools stay silent),
      and a volume control.
- [x] A kicker on the first quarter of Falls View Park's levee, centred on
      the crest. Its course revision starts a new board.
- [x] A better social card for shared links, with a ghost link's racer,
      time, and rank.
- [ ] Phase 5 closeout and integration review.

**Done when:** a board's standings and medals come only from verified runs and
cannot be forged by client state; a guest finishes, logs in, and finds the
claimed run on the board; and a friend's ghost link races their best.

### Phase 6: Private Multiplayer

**Goal:** make the demo social, with kart-to-kart contact handled by one
authoritative system.

**PR 6.1: Private rooms and race lifecycle**

- [ ] Create a private room and join by link; 2–4 players, guests welcome.
- [ ] Choosing a kart marks a player ready; the host starts a synchronized
      countdown.
- [ ] Opponents are visible with coherent race progress.
- [ ] Synchronized results with placements, and replay in the same room. The race ends when all
      active players finish or shortly after the first finisher.
- [ ] No public matchmaking or ranked multiplayer leaderboard.
- [ ] Rooms race official karts on Falls View Park, recording each kart's
      revision and the course's, as Phase 5's results do.

**PR 6.2: Motion and resilience**

- [ ] Define server authority, update cadence, prediction, interpolation,
      reconciliation, and bounded correction.
- [ ] Keep remote presentation separate from authoritative race and collision
      state.
- [ ] Survive latency, packet loss, reordering, backgrounding, disconnects,
      reconnects, and host departure without hanging the room.
- [ ] Keep all input methods, reset, pause, and resilience behavior working.
- [ ] A four-kart room stays within the phone budget on the lead's iPhone
      (`?perf=1`).

**PR 6.3: Kart-to-kart collisions**

- [ ] Resolve each kart-to-kart contact once, authoritatively, using both karts'
      mass, relative velocity, contact normal, and angle of attack.
- [ ] Sync collision impulses without remote tunneling or explosive
      corrections.
- [ ] Version the room's sync messages so Phase 8's joint damage can extend
      them.

**Done when:** a host creates a room, a guest joins by link, both ready up and
race, and results resolve without hanging; the room can replay; and rubbing,
glancing, rear-end, head-on, pileup, airborne, wall-pinning, and concurrent
kart/environment contacts each resolve once and stay in sync under latency and
disconnects.

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
- [ ] Ships in the admin kart builder; players get it in Phase 8.

**PR 7.3: Assembler credit and royalties**

- [ ] Each published kart revision records its assembler and license terms:
      whether others may race and remix it, and a payment type of
      attribution or free.
- [ ] A server-owned ledger counts races, room uses, and remixes for each
      published kart, computed from the race results and kart revisions that
      Phases 5 and 6 record, with no new telemetry. Kart cards and assembler
      profiles show it.
- [ ] Official karts come first; community karts and remixes join in Phase 8.

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

### Phase 8: Community Karts And Structural Breakage

**Goal:** every logged-in player can build, publish, and race karts, and karts
can break in a readable, forgiving way.

Reuse the Phase 3 kart document, derivation, editor, and revision pipeline. No
second format, raw tuning, or creator-set stat or joint-strength numbers.
Publishing is immediate, with no approval queue.

**PR 8.1: Player kart ownership and publishing**

- [ ] Role-aware player kart editor without admin or roster controls.
- [ ] Players create, edit, and save only their own private drafts.
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

**PR 8.2: Community kart discovery, play, and safety**

- [ ] Public catalog that clearly separates official and community karts.
- [ ] Anyone can race any published community kart in casual modes.
- [ ] Players can bring a published community kart into a private room.
- [ ] Community karts' races, room uses, and remixes count in the Phase 7
      ledger.
- [ ] Admins feature or safety-unpublish karts without changing stats,
      eligibility, history, or audit data. Unpublished karts leave discovery
      and guest play.

**PR 8.3: Structural joints and forgiving breakage**

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

### Phase 9: Community Courses

**Goal:** players publish, discover, race, and curate courses with no approval
queue.

Reuse the existing course document, revisions, and editor. No second format or
editor. The Starter Course (`rough-course`) is the template new community
courses start from.

**PR 9.1: Player course ownership and publishing**

- [ ] Role-aware player course editor without admin-only controls.
- [ ] Players create, edit, and save only their own private drafts.
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

**PR 9.2: Public course discovery and play**

- [ ] Public catalog separating the official circuit from community courses,
      with featured, popular, and new views.
- [ ] Anyone can launch a published course, and each race records the course ID
      and publication revision.
- [ ] A host can pick a published community course for a private room.
- [ ] Remove rough-course and Falls View Park assumptions from shared race
      systems while keeping official-course selection and recovery working.

**PR 9.3: Ranking, featuring, and safety**

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

### Phase 10: Public Demo Polish

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
      milestones…", which time out clicking Exit).
- [ ] Analytics review: confirm we can measure time to first race, race start
      and completion, replays, room joins, shares, login after a race,
      leaderboard submissions, community publishing and play, thumbs-ups,
      controller use, and where players drop off.

When Demo v1 is accepted, delete this plan.
