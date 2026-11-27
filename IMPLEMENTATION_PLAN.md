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

- **Done:** Phases 0–7 (PRs #1–#24, the Phase 3 closeout and its
  follow-ups, #30–#57 with the PR 4.5.2 closeout, #59–#63, #64–#70 with
  the Phase 6 closeout, the Phase 6 addendum #71–#76, and #77–#80 with
  Phase 7's integration review).
- **Now:** PR 8.3, look behind and first person.
- **Next:** PR 8.4, a wider touch steering dead zone, then Phase 8's second
  official course.

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
- **CAD authoring:** build123d (on OpenCASCADE) for admin part models, used
  only in development and never in the app runtime (Phase 7).
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

**Floodlit** (accepted in the Phase 6 addendum): every screen looks like a
race at dusk under its floodlights. It keeps the Titan Racers site's palette
and type, re-weighted:

- Pages are mostly true black, with translucent panels over the render
  behind them; lists are divided by thin rules.
- A screen leads with at most one real in-game render, fading hard into
  black. No AI-generated imagery.
- Arial/Helvetica-style sans and Courier-style mono labels: heavy uppercase
  headlines, larger than before, and widely tracked operational labels.
- Ice text. Orange marks only a screen's next action; hazard yellow marks
  focus, what is selected, and the HUD's and cards' labels; blue stays for
  the ghost and rare technical accents.
- The logo stays top-left, unchanged.

The HUD should feel like a racing operations interface, not a lore panel or a
neon arcade skin. The race's screens and the app's controls keep their look
from before Floodlit, in Floodlit's type: the HUD's clipped plates with
orange and hazard rules, and translucent panels over a blurred race. Home's
controls hover hazard; the leaderboard's hover ice, so its yellow means
selected. Multiplayer is called "Multiplayer" everywhere a player sees it.

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
| 6 addendum. Feedback before Phase 7 | Race screens that never select text, zoom, or open the long-press menu; each race's fastest lap on the result screen and as a second leaderboard ranking; Restart in the pause menu; course objects that change state during a race, starting with the utility tunnel's door 4 and its store room, the same for every racer in a room; the Floodlit look on home, the result screen, leaderboard, rooms, and the main site, with real renders in place of AI images; a park of benches, bins, trees, shrubs, and flower beds, clipped privet hedges, and service-road planting, grown behind the loading screen; races drawn 1.15 times as colourful; room-server logs and a fix for doubled draws; integration review. | #71–#76 |
| 7. CAD assembly and kart royalties | Admin part models in build123d, with committed meshes the game reads, for the motor, transmissions, and servo, and tie rods and driveshafts that follow the steering and suspension; kart assembly by named mounting points with snapping, clearance and linkage clash checks that block saving, a real 2WD rear end on all three official karts, and Explode, Motion, X-ray, and Measure in the admin builder; cables drawn from each kart's connections; scores from the top 20 on each official course's current board, a 10% assembler share under one fixed licence, High scores and a course row on the leaderboard, and your score on the profile; integration review. | #77–#80 |

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
  and Phase 6's two-player room with contact 3 / 6 ms. Heavy startup work
  (the park and the hedges' boughs) grows after a race's first frame,
  behind its loading screen
  ([progressive loading](skills/game-concepts/progressive-loading/README.md)).
  First frames vary from sitting to sitting, so compare one with `main`'s
  in the same sitting.
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
  never stored. The server's check also finds each lap and keeps a run's
  fastest (PR 6.8): the leaderboard ranks each racer's best race by total
  time or by that race's fastest lap, and medals stay with total time.
  Runs through the storm drain stay eligible because gates
  count only in order and its chute is the only way back in; re-check if a
  course change opens another way back in.
- **Course objects that change state are real mechanisms** (PR 6.9), under
  the [course interactables standard](skills/game-concepts/course-interactables/README.md):
  physical strengths, closed again at each race start, Restart, and Race
  again but never on a kart's reset, and passed through by ghosts. Nothing
  they do counts toward a run, so a course that adds one publishes with New
  leaderboard off. In a room, the opener's page acts at once and the room
  keeps the race's first opening.
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
  once, the record Phase 9's damage extends. The room server's logs name
  only a seat (`p1`–`p4`) and a race ID, and the platform's own request
  logs stay off, since a join's URL carries its token (PR 6.12).
- **One room protocol version is live at a time,** raised for each change
  to its messages (5 since PR 8.2): deploy the room server just before the
  app's PR merges, with no race running. Rooms stay on Cloudflare's Free
  plan until a shared demo; before any shared link, move to Workers Paid
  with the protections Phase 12 lists.
- **Home is a step-by-step flow**, one history entry a step, with no Quick
  race, and menus sound on every action except in the admin tools. Its
  first screen offers Time Trial, Multiplayer, and Leaderboard (PR 6.6). A
  time trial goes on to the kart, course, and ghost; Multiplayer creates a
  room or joins one by its code (PR 8.2), where each racer chooses a kart
  and the host the course (only Falls View Park so far).
- **CAD stays out of the game** (Phase 7). build123d is an admin authoring
  tool pinned in a development-only environment under `cad/`; each part is
  a script of named parameters modelled on a real 1:10 part, and writes a
  committed mesh that the part's code-built visual reads directly, with no
  model loader. Visuals stay presentation only. text-to-cad is not used:
  its installer sets itself up in every agent app it finds and sends usage
  stats by default.
- **Karts assemble by mounting points** (PR 7.2). Parts declare named
  points; kart schema 3 names the point at each end of a structural
  attachment, and schema 1 and 2 documents migrate with none, so stored
  revisions load and race unchanged. Solid overlaps, linkage clashes, and
  unsnapped parts block saving. A part that changes ships as a new part
  version, with the old one kept for older revisions; a new version takes
  the real part's published weight, else its CAD mass, and its centre of
  mass from CAD. Leaderboards keep bests set with earlier official karts.
  Cables are drawn from a kart's existing connections, store
  nothing, and stay out of the save gate.
- **Each official kart holds the phone budget's kart caps:** 30k
  triangles with its springs and arms, each CAD part and each kart's cables
  within 2,000, the racer's own kart within 30 draws, and a ghost or
  opponent at 2 (tested). PR 7.1's first frame, about 100 ms slower than
  before, is an accepted exception recorded in the budget.
- **Scores and royalties are worked out, never paid** (PR 7.3). Every
  published kart carries one standard licence fixed in code, shaped like
  an [RSL 1.0](https://rslstandard.org/) licence: it may be raced and
  remixed and pays 10% of the points earned with it to its assembler.
  Players never choose or see terms. Points come only from the top 20 of
  each official course's current board by total time (300, 250, 210, 180,
  160, then 150 down by 10 to 10), the racer keeping 90%; fastest laps,
  older boards, and multiplayer earn nothing. Scores are worked out on each
  read from each racer's best per board, with no stored ledger, and
  responses name usernames only. An official kart's share goes to Titan
  Racers, which has no account and players never see earning, so kart
  cards show no earnings. Payments, balances, and on-chain actions need a
  separately accepted scope.
- **"Score" is always a noun in player copy** ("your score"). The
  leaderboard opens on High scores, with a row of courses opening each
  course's race board at `?course=<id>`; old `?board=` links open Falls View
  Park's.
- **Component engineering is a separate later phase.** Kart assembly uses
  sealed, freely available parts with no progression tiers. If component
  engineering is planned, progression unlocks engineered *parts*, an engineered
  component's tier is the highest tier among its parts, and neither tiers nor
  stats can be overridden.

## Remaining Phases

### Phase 8: Second Official Course

**Goal:** a second official course, in a village or town, between Falls View
Park's rural parkland and Phase 10's city.

First, small PRs before the course:

- [x] PR 8.1: Kerb fix. No step at a wall's or barrier's end catches a
      kart sliding along it: the downhill's crowd barriers end flush on the
      return turn's kerbs, with no blocks joining them, and the downhill's
      first kerbs start flush with the stream bridge's walls. Production
      resets Falls View Park to the seed and publishes it without starting
      a new leaderboard.
- [x] PR 8.2: Room codes and QR. A room code is 5 characters from the same
      31-character alphabet (no 0/O or 1/I/L), shown in capitals and typed
      in either case; `room_races` accepts the new shape (migration 0031)
      and keeps past races' 10. Multiplayer on home opens a step with
      Create room and a "Join with a code" field, and the room server
      limits join attempts from each address
      ([room guide](skills/project-systems/multiplayer-rooms/README.md)).
      Old 10-character links
      stop working. Each join token states why the page joins,
      and the room decides as it joins (room protocol 5): creating refuses
      an occupied room and the page picks another code, a typed code refuses
      an empty room ("No one's in that room"), and a link or QR code opens
      or joins as today. The lobby shows the code large beside a QR code of
      its join link (`qrcode.react`, dark on a light tile) and Copy room
      link, on phones too.
- [ ] PR 8.3: Look behind and first person. Holding C, a controller's Y,
      or the touch button above the pedals cuts the race camera to face
      back, and letting go cuts it forward; a pause, a reset, or leaving the
      tab ends it until pressed again. A First-person view switch, saved on
      the device like Sound, in home's menu and the race's pause menu, races
      from a camera on top of the kart's body instead of the chase camera.
- [ ] PR 8.4: Touch steering dead zone. Driving straight on the touch
      joystick is too hard: widen the dead zone for steering alone.

Then the course:

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
      and let a room's host pick either official course. A course board's
      Race and Copy link ghost buttons must name its course; today they
      assume Falls View Park.
- [ ] Measure a four-kart room race on the iPhone (`?perf=1`) with Phase 7's
      CAD parts, linkages, and cables, which no room race has measured yet:
      an opponent may draw more than twice when its parts use several
      finishes.

**Done when:** the second course is published, races two laps solo and in a
room, has its own leaderboard, and holds the phone budget.

### Phase 9: Community Karts And Structural Breakage

**Goal:** every logged-in player can build, publish, and race karts, and karts
can break in a readable, forgiving way.

Reuse the Phase 3 kart document, derivation, editor, and revision pipeline. No
second format, raw tuning, or creator-set stat or joint-strength numbers.
Publishing is immediate, with no approval queue.

First, the Steam Deck, before the kart work:

**PR 9.1: Steam Deck**

- [ ] The game plays well in a browser on a Steam Deck (Chrome in Desktop
      Mode first): its sticks, buttons, and touchscreen, and the 1280×800
      screen with the browser's bar. Today the d-pad steers and the left
      stick doesn't; find out first whether Chrome sees a gamepad at all. A
      non-Steam-game launcher is not planned.

**PR 9.2: Player kart ownership and publishing**

- [ ] Role-aware player kart editor without admin or roster controls.
- [ ] Players create, edit, and save only their own private drafts.
- [ ] A racer kept in one browser that owns a kart can't be brought into
      another (PR 6.3): decide whether a merge moves its karts.
- [ ] Players assemble with Phase 7's CAD-style tools. Cables route only
      over a box chassis plate's top face, so first route them under the
      plate and around a round root (or keep players from those layouts).
- [ ] Players remix any published kart: the draft starts from that
      revision, and the published remix credits the original assembler and
      links its source revision. Decide whether a remix passes part of its
      royalty back to the original's assembler.
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

**PR 9.3: Community kart discovery, play, and safety**

- [ ] Public catalog that clearly separates official and community karts.
- [ ] Anyone can race any published community kart in casual modes.
- [ ] Players can bring a published community kart into a private room.
- [ ] Decide how community karts earn points: they race casually and never
      reach a leaderboard, so under PR 7.3's scores their assemblers earn
      nothing. Scores count only official karts' shares today, so a
      community kart's share must go to its assembler's score. Also decide
      how the royalty splits once part engineers share it, and how a share
      too small to split rounds.
- [ ] Public racer pages, linked from the score board, and each score
      board row split into racing and royalties. Kart cards show what a
      community kart has earned its assembler.
- [ ] Admins feature or safety-unpublish karts without changing stats,
      eligibility, history, or audit data. Unpublished karts leave discovery
      and guest play.

**PR 9.4: Structural joints and forgiving breakage**

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
- [ ] Lobby polish, onboarding copy, and UI clarity, including a controls
      screen: no page explains the keys and buttons (Shift, R, C, or the
      controller's), and only wide screens show a few keys in the race.
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
      and fastest karts off the levee kicker onto the crest". "races
      Falls View Park as the solo course through two laps" timed out
      there in PR 6.11, on `main` too. Serial groups skip the tests after
      a failure, so fix these first.
- [ ] The next four-player room test's logs (Cloudflare Workers Logs)
      confirm whether karts still turn see-through after PR 6.12's fix for
      doubled draws.
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
- [ ] The main site's own newsletter list, replacing the RaidGuild Forge's
      (PR 6.10): a subscriber table, confirmation emails, and an email
      provider, collecting only an email address.
- [ ] Analytics review: confirm we can measure time to first race, race start
      and completion, replays, room joins, shares, login after a race,
      leaderboard submissions, community publishing and play, thumbs-ups,
      controller use, and where players drop off.

When Demo v1 is accepted, delete this plan.
