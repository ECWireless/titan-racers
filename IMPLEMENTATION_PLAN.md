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
  with the Phase 6 closeout), the Phase 6 addendum (#71–#76), and PRs 7.1
  (#77), 7.2 (#78), and 7.2.1 (#79).
- **Now:** [Phase 7](#phase-7-cad-assembly-and-kart-royalties), PR 7.3.
- **Next:** Phase 7's integration review, then Phase 8 after its debrief.

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
  to its messages (4 since PR 6.9): deploy the room server just before the
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

### Phase 7: CAD Assembly And Kart Royalties

**Goal:** make kart assembly feel like CAD, rebuild selected approved parts with
new authoring approaches, and credit assemblers with tracked, displayed
royalties.

Phase decisions:

- **Racing and assembly only.** Players assemble approved parts and engineer
  nothing. Only admins engineer parts, and the component-engineering boundary
  in `docs/kart-system/components-and-materials.md` still holds.
- **CAD stays out of the game.** build123d (on OpenCASCADE) is an admin
  authoring tool used only in development, never in the app runtime; the
  game reads the meshes it writes. text-to-cad is not used: its installer
  sets itself up in every agent app it finds, and it sends usage stats and
  checks for updates by default.
- **Royalties are tracked and displayed, never paid.** Payments, balances, and
  on-chain actions need a separately accepted scope.

**PR 7.1: Admin parts with new approaches**

- [x] build123d is pinned in a development-only Python environment under
      `cad/`. Each part is a script of named parameters, modelled on a real
      1:10 part, with no vendor models.
- [x] Each script writes a committed mesh, triangles per finish, that the
      part's code-built visual reads directly: no model loader, so the race,
      editor, thumbnails, ghost, and opponents use it unchanged. Running a
      script again reproduces its mesh exactly.
- [x] The motor, the three transmissions, and the steering servo get CAD
      visuals. Tie rods follow the steering, and rear driveshafts follow
      each wheel's travel, posed from the same inputs as the wheels.
- [x] Visuals stay presentation-only, so registry fingerprints, derivation,
      revisions, and hashes do not change. Each CAD part's measured mass and
      centre of mass are reported beside the registry's; any correction
      joins PR 7.2's new part versions, so the official karts change once.
- [x] Claude Fable 5.2, Claude Opus 5.5, and Codex `gpt-6-astra` each build
      the parts and linkages to one brief on the shared pipeline. Two fresh
      judges from models that built nothing (Claude Sonnet 5.5 and Codex
      `gpt-6.1-sol`) score all three from the same renders and numbers, and
      the lead decides blind, category by category: motor, transmission,
      servo, and linkages. Fable's entry won every category and landed
      whole.
- [x] Each official kart stays within 28k triangles, counting its springs
      and arms (tested), each CAD part within 2,000, the racer's own kart
      within 30 draws, and a ghost or opponent at 2, so a four-kart room
      holds the phone budget. Measured on the iPhone at the PR's end
      against `main` in one sitting
      ([numbers](docs/visual-identity.md#baseline)): no new draws, and a
      first frame about 100 ms slower, which the lead accepted. The room
      race was skipped, as the linkages join the kart's batches.

After merge, the official karts' thumbnails are captured again at the new
render version from the admin roster.

**PR 7.2: CAD-style assembly**

- [x] Parts declare named mounting points, each with a position, an outward
      direction, and a type: a base footprint that sits and slides on any
      flat structural face, a motor face that meets a gearbox's motor plate,
      and a gearbox tower pad. Authored boxes offer their six faces. Parts
      snap when two points meet with opposed directions, and a footprint
      rests fully on its face. Suspensions and wheels keep their named
      points. In the builder a part snaps when dropped or attached within
      10 mm of a matching point, and then stays on it: a footprint slides
      and turns on its face, the motor turns about its shaft, and pins and
      hubs hold still. Detaching frees it.
- [x] Mounting points ship as new part versions, not a separate registry:
      the battery, controller, motor, servo, brakes, and three
      transmissions. The `@1` parts and their CAD meshes stay for older
      revisions.
- [x] Kart schema version 3 names the mounting point at each end of a
      structural attachment. Version 1 and 2 documents migrate with none,
      so stored revisions load, verify, and race unchanged; a draft saves
      again once its parts are swapped and snapped. Derivation stays at
      version 5, and the database needs no migration.
- [x] Each new version declares the published weight of the real part it
      copies, or else its CAD-measured mass, and takes its centre of mass
      from CAD: servo 44.5 g, motor 190 g, 4:1 103.4 g, 5:1 104.1 g, and
      8:1 182.9 g. The motor and servo take the real parts' proportions.
      Each transmission gains a motor plate and a full-size spur, so the
      motor bolts on ahead of it as on a real laydown gearbox, and a pad on
      top for the rear tower.
- [x] All three official karts get a real 2WD rear end: the gearbox outputs
      sit on the rear axle line, each rear hinge-pin mount splits into a
      block under each arm leg so the driveshaft passes between them, the
      rear tower stands on the gearbox, and the motor bolts to the gearbox.
      The karts change once, and the lead drive-checks all three.
- [x] Clearance and interference checks measure overlap and closest points
      between parts' solid shapes, and between tie rods and driveshafts
      swept through suspension travel and steering lock. Either kind of
      clash blocks saving, as does a part not snapped by mounting points.
      The builder runs the same check in the background as you edit.
- [x] Exploded and x-ray views, with the suspension posed from wheel travel
      and steering, and measured readouts for the kart, the selected part,
      and the gap between any two parts. Presentation only. The builder
      shows Build, Explode, and Motion views, with X-ray over any of them;
      Motion poses all four wheels from one pad, and parts move only in
      Build. A Measure tool reads the gap from the selection to another
      part, live as the kart moves. The kart shows its ground clearance,
      each part its dimensions, and one line says whether the kart can be
      saved.
- [x] Ships in the admin kart builder; players get it in Phase 9.
- [x] Leaderboards keep bests set with the earlier official karts.

After merge, each official kart's stored draft is still schema 2, so it is
loaded from its bundled design (**Actions → Load official design**), saved,
and published again from the admin roster.

**PR 7.2.1: Wiring**

- [x] Cables drawn from each kart's existing functional connections: the
      battery to the controller (red and black), the controller to the
      motor (three phase wires) and to the steering servo and brakes (one
      lead each). They change nothing the kart stores: no document fields,
      part versions, derivation, or hashes.
- [x] Ports keep saying which connections exist; where a wire leaves a part
      comes from its visual: named points in the motor's and servo's CAD
      models, as the linkages use, and points the battery, controller, and
      brakes export beside the shapes they build. Older part versions get
      them too.
- [x] Cables lie along the parts they cross: routed over a height map of
      the chassis plate, round the parts resting on it and clear of the
      space the tie rods and driveshafts sweep. A lead of several wires
      runs as one bundle. They are left out of the clearance check and the
      save gate; tests show the official karts' cables clear every part's
      solid shape and every linkage.
- [x] In the builder, cables re-route live as parts are dragged, hide in
      the Explode view, and fade in X-ray with the parts around a focus.
- [x] No new race draws: cables reuse the kart's materials and join its
      batches. The per-kart cap rises to 30k triangles, with each kart's
      cables within 2,000 (tested), and the kart thumbnail render version
      advances. Measured on the iPhone
      ([numbers](docs/visual-identity.md#baseline)): no new draws, and frame
      time, CPU work, and the first frame unchanged.
- [x] The drawn coilover and the clearance check share one set of coilover
      sizes, so resizing the drawn shock moves its clash shape too.

After merge, the official karts' thumbnails are captured again at the new
render version from the admin roster.

**PR 7.3: Scores and royalties**

- [x] One standard kart licence, shaped like an RSL licence and fixed in
      code: every published kart may be raced and remixed, and pays a fee
      of the "use" kind, 10% of the points earned with it. Players never
      choose terms or see them; a change to the fee applies to every
      score from then on.
- [x] Points come only from time-trial standings: on each official
      course's current board (its live revision under the current physics),
      ranked by total time as the leaderboard ranks, the top 20 earn 300,
      250, 210, 180, and 160, then 150 for 6th down by 10 a place to 10 for
      20th. Fastest laps, older boards, and multiplayer earn nothing. Points
      follow the live standings, so they can be lost, and a course's new
      board starts its points again from zero.
- [x] The racer keeps 90% and the kart's assembler gets 10%. An official
      kart's share goes to Titan Racers, which has no account and is not on
      the score board, so players' royalties start with community karts.
- [x] Scores are worked out on each read from each racer's best per board,
      with no stored ledger, new telemetry, or migration. Responses name
      usernames only.
- [x] Players see a "score", always as a noun. The leaderboard opens on
      High scores (rank, username, score; no medals, which stay with race
      results), with a row of courses under their pictures that opens a
      course's race leaderboard as it was (`?course=<id>`); old board links
      still open Falls View Park's. A run kept from before signing in
      records its course and lands on that course's board. The profile
      shows your score. Kart cards show no earnings: an official kart's
      share goes to Titan Racers, which players never see earning.
- [x] Claude Fable 5.2 and Codex `gpt-6.2-astra` each designed the score
      board and course selector on the same seeded scores, with a stand-in
      second course, and the lead picked Fable 5.2's blind.

**Done when:** a rebuilt part shows on every kart that uses it without changing
any derived stats, within the phone budget; karts assemble by mounting points
with clearance checks, and older revisions still race unchanged; and each
published kart credits its assembler and earns it a share of the points
raced with it, and the leaderboard ranks racers by score, with nothing paid
out. Phase 7's integration review runs before the phase closes.

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
      and let a room's host pick either official course. A course board's
      Race and Copy link ghost buttons must name its course; today they
      assume Falls View Park.

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

**PR 9.2: Community kart discovery, play, and safety**

- [ ] Public catalog that clearly separates official and community karts.
- [ ] Anyone can race any published community kart in casual modes.
- [ ] Players can bring a published community kart into a private room.
- [ ] Decide how community karts earn points: they race casually and never
      reach a leaderboard, so under PR 7.3's scores their assemblers earn
      nothing. Also decide how the royalty splits once part engineers share
      it, and how a share too small to split rounds.
- [ ] Public racer pages, linked from the score board, and each score
      board row split into racing and royalties. Kart cards show what a
      community kart has earned its assembler.
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
