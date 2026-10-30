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
- **Next:** Phase 4: visual baseline, Island Three, and Falls View Park.

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
- One official track: the Falls View Park Circuit.
- Two-lap solo time trial with a result screen after every race.
- Three official karts (Balanced, Speed, Handling) with distinct handling, each
  showing name, assembler credit, visual identity, stat bars, and a short
  descriptor.
- Keyboard, touch, and gamepad controls, plus fast reset.
- Developer ghost and player-best ghost.
- Login-gated solo leaderboard.
- Falls View Park best-time medals that set progression tiers.
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
  uses its own course ID, `falls-view-park` (`agricultural-zone` until PR
  4.3.4), and publishing or guest play must never mix the two.
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

### Phase 4: Visual Baseline, Island Three, And Falls View Park

**Goal:** give Titan Racers a consistent visual identity, physical surfaces,
and its home inside the Island Three habitat, then build the Falls View Park
Circuit there.

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
  it, so nothing is hard-coded to one course. The distant cylinder
  renders as its own layer, and course physics stays local.
- **Rotating-habitat physics at true scale.** Position-dependent artificial
  gravity (`g × r / R`) plus Coriolis force replace the fixed Earth gravity
  under a new physics version, with no exaggeration.
- **Near-axis, low-gravity racing belongs to a later course** placed near the
  axis, not to Falls View Park.
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
- [x] 4.3.3: Course loading screen showing Island Three from outside in
      space, held for a short minimum. Shipped as a ray-traced view of the
      habitat spinning at its true rate, with Saturn and its rings behind:
      Island Three orbits Saturn with Titan. The race builds behind it, and
      the screen holds for at least 2.5 s before fading into the countdown.
      The home screen keeps its own backdrop for now. The `home.spec`
      recovery test now pauses the race as it becomes ready, before it can
      start racing.
- [x] 4.3.4: Valleys and distant structures. Shipped as a land-use
      research note (`skills/game-concepts/habitat-land-use/`) and, following
      it, the official course renamed Falls View Park (`falls-view-park`) on
      the Starter Course's layout until PR 4.4 builds its route, 2.5 km from
      the sunward cap. Migration 0017 adds the ID to the telemetry check and
      keeps `agricultural-zone` for older runs and clients; in production,
      migrate before deploying, then an admin initialises and publishes the
      course. The valleys now hold parkland, woods, villages, and towns, with
      rolling hills, town buildings, the end caps' terraces and elevators, a
      suspension bridge over the falls lake, and trees as billboards baked
      from CC0 Poly Haven scans. An 800 m waterfall drops down a granite
      gorge in the sunward terraces, bending about 426 m anti-spinward as the
      habitat turns. All within the phone budget on iPhone `?perf=1`.
- [x] 4.3.5: Dusk and night. Shipped as the habitat's daylight: what the
      mirrors send onto its floors and caps, falling to nothing as a mirror
      opens fully toward 90°, where its window sees only space. The haze
      glows with it, and the race exposes for its course's key light as eyes
      adjust. Course schema v5 adds up to four floodlights per course (12 m
      masts, about 250,000 cd, no shadows; lamp shadows were decided against)
      and mirrors up to 90°. Falls View Park is seeded at deep dusk (89.5°)
      under four, with the falls floodlit, the bridge lit, and street lamps
      and a few floodlit fields across the valleys; in production an admin
      initializes and publishes it. The loading screen shows Island Three by
      day. The iPhone sun-shadow flicker came from the chase camera widening
      with speed, so the shadow fit now holds the widest view; sun shadows
      reach 60 m in two blended cascades with a faded far edge. The three
      failing tests were fixed. Deferred: the course's direct sun renders
      about a third dimmer than the habitat model assumes (PlayCanvas applies
      light intensities below 1 before linearising the colour), and
      `home.spec`'s lost-WebGL-context recovery test already fails on `main`.

**PR 4.4: Falls View Park Circuit** (split by route section)

A two-lap circuit of about 500–550 m a lap, authored under `falls-view-park`
from the Starter Course layout it took in PR 4.3.4. Courses are rough circuits
the habitat's youth build through the infrastructure already there, so
everything stands at real size around the 1:10 karts: pipes, vents, culverts,
doors, rails, ramps, and catwalks that make them feel tiny. The lap reveals the
habitat step by step, and each beat is one moment the route shows:

1. **Utility tunnel:** the park's service tunnel under the soil, carrying its
   water, power, and air, with the start/finish inside. Nothing of the
   habitat shows.
2. **Tree nursery rows:** tight turns between rows of young trees, with
   glimpses of sky through them.
3. **Stream and culvert:** the stream's banks open the view a little, then a
   narrow culvert ducks under the water.
4. **Levee crest:** the climb onto the stream's flood levee reveals the
   floodlit falls, the terraced sunward cap, and the bridge's lamps.
5. **Downhill run:** a fast descent off the levee heading anti-spinward, with
   the floor curving up ahead and a jump that shows the spin's effect on a
   flying kart.
6. **Return lane:** heading anti-sunward, with street lamps running down the
   cylinder's length, back into the tunnel portal.

The route stays clearly lit at deep dusk (89.5°).

In-world, the youth borrow the park's maintenance network after hours and
stitch it into a loop: the tunnel is the park's service road, the nursery
rows its access lanes, the culvert a link only a kart can take, the levee
crest its inspection track, the downhill its access ramp (the jump is the
youth's own), and the return lane a service lane. Everything permanent is the
park's, at full size; the timing portal, grid tape, jump, and improvised
barriers are the youth's portable race kit
([visual identity](docs/visual-identity.md#course-surfaces)).

- [x] 4.4.1: Carry-overs from PR 4.3.5, then the route layout. Shipped:
      the sun renders at the habitat model's brightness, and the
      lost-WebGL-context tests allow for the software renderer's slow dusk
      frames. Falls View Park is a walled blockout of the full route, about
      550 m a lap with 4.5 m lanes for four karts abreast; its downhill
      forks into a jump lane and a gentle lane. A course may carry eight
      floodlights (schema v5, no migration); Falls View Park places eight
      outdoors, within the phone budget.
- [x] 4.4.1.1: Falls View Park seed reset and wheel motion blur. Shipped:
      the guarded seed reset (`db:reset-course-seed`) covers
      `falls-view-park` as well as the Starter Course, and production's
      Falls View Park was reset to the 4.4.1 route. Wheels show their spin,
      presentation-only and driven by the tire's rolling speed: tread
      blocks, sidewall lettering, and machined spokes blur over at least
      1/15 s (an art choice) into grey rings, with no full-screen pass. The
      chase camera sees mostly black tread, so the blur shows best side-on.
      Within the phone budget.
- [x] 4.4.2: Utility tunnel, with its own lights. Shipped: the
      start/finish sits in a cut-and-cover service
      road under an earth berm: 4.5 m lane, 3.6 m clear height, a pipe bay
      behind a kerb bench, and a junction chamber at the right-hander, where
      the bend's barriers are smooth arcs, a new course primitive drawn
      within 3 mm of a true circle. Indoor objects take only indoor light
      (a second light channel and an interior environment), so habitat
      light and floodlights no longer pass through the roof, and the kart
      switches light at the portals. Twelve 8,600 cd ceiling lamps and the
      youth's work light over the start light it, and the tunnel is dressed
      at full size: mains, numbered doors, cabinets, trays, centre line,
      chevrons, sump and valves, and finished portals. The editor cuts away
      roofs, marks objects indoors or overhead, places tunnel lamps (16 per
      course beside 8 floodlights), and takes up to 1,000 objects. Course
      schema v6, no migration. Within the phone budget, frame and CPU time
      unchanged.
- [x] 4.4.3: Tree nursery rows and the service-road bypass, and how their
      trees look. Shipped: the nursery is raised, mulched, timber-edged
      beds of young trees at real size (3.2 m nursery standards on stakes,
      leaf sprays baked from a CC0 scan) with turf alleys through its
      hairpins. The service road swoops south behind windbreak and screen
      hedges, which keep the east view for the climb out of the nursery,
      then climbs an access ramp onto the levee crest: tight hairpins or a
      longer, faster sweep. Four more floodlights light the road at dusk,
      raising the course limit to twelve. The race drops the nursery and
      culvert checkpoints. The park stands 0.9 m off the habitat floor, so
      the floor's curve stays below the chase camera.
      The engine-backed lighting test checks the kart's light switch at
      each portal, on both meshes, after a reset, a batch rebuild, and a
      new race. Course schema v7 (planted beds, hedges), no migration.
      Within the phone budget; CPU work rose about 1 ms.
- [x] 4.4.4: Stream, culvert, and levee vista, and how the water looks.
      Shipped: the stream runs perched between the levee and a
      concrete-faced bank, 0.3 m of clear water over a river-gravel bed,
      falling 1 in 3,000 west to a weir and an outfall chamber at the
      perimeter wall, where water would really leave the park; the wall
      stays clear beside it for 4.4.7's storm drain. The water reflects as
      water does, its ripples drift downstream, and a kart that goes under
      drowns and is recovered. The culvert is a precast 1.5 × 1.2 m box
      under the bank, stream, and levee, lit by a string of six of the
      youth's battery work lights. The levee's riverside is a grass slope
      and the crest's stream side a kerb and tubular handrail, so the stream
      shows from the crest. The nursery's trolley lanes are brushed
      concrete and its hairpin edges round. The levee's curved walls are
      true arcs and its route is asphalt drawn without a layer bias, so no
      side faces flicker through the walls; the climb's wall slits are
      closed, and the hairpin merge is marked with arrows and chevron
      boards. To dodge after the vista, two of the youth's bicycles stand
      at the crest's edges, built at real size and colliding as their own
      shapes: a hardtail leaning on the handrail and a BMX laid over against
      the wall. Course schema v8 (water, concrete, gravel, work lamps, and
      bicycles; twenty indoor lamps), no migration. Frame time, CPU work (a
      4 ms median, p95 5–6 ms), and draws (about six more) stay within the
      phone budget, but startup does not: the first frame takes 465–549 ms
      warm, against about 436 ms allowed, deferred to 4.4.8.
- [x] 4.4.5: Downhill run and spin jump. Shipped: past the crest the
      levee's track crosses the stream on a bridge and comes 3 m down to
      the park on an asphalt S-bend ramp over concrete fill, with kerbs.
      The youth's jump is a shortcut: a plywood kicker at the ramp's left
      edge sends karts straight on, anti-spinward, over the S's inside onto
      their plywood landing deck on timber, taped every 2 m, which ends on
      level ground beside the road; their steel crowd barriers fence both
      sides. In test flights every official kart landed it upright, straight
      on, from the 8 m/s the Handling Kart tops out at to 16 m/s; a launch
      turned 8° west misses the deck and lands, often upside down, inside
      the barriers. Course layers' slope depth bias is a quarter of a pixel a
      layer, so markings no longer draw over a ramp's thin toe. Karts
      hopped down slopes because grounded heave damping slowed motion along
      habitat up, lifting a kart that rolls steadily downhill; it now damps
      motion off the surface the wheels are on, under physics version
      `support-heave-v1`. Course schema v8, no migration. Frame time and
      draws stay within the phone budget and CPU work at its 5 ms top;
      startup is unchanged, still over budget for 4.4.8.
- [x] 4.4.6: Return lane and finish. Shipped: the park's return
      service lane has 150 mm kerbs, true arcs at its turn, ice edge lines,
      and four 6 m street-lamp columns leading anti-sunward to the tunnel;
      the crowd barriers still seal the downhill's infield. The dusk pass
      adds one ceiling lamp at the junction chamber's approach, within
      twelve floodlights, twenty indoor lamps, and four of eight street
      lamps. Course schema v9 adds the outdoor street-lamp kind and editor
      preset; v8 documents upgrade in memory, with no database migration.
      Two iPhone races keep frame time and draws within budget, with CPU
      work at its 5 ms median limit and no hitches. Startup remains over
      budget for 4.4.8. Production stays on its earlier seed until 4.4.8.
- [ ] 4.4.7: Off-track clearing. A storm drain through the perimeter wall,
      about 30 cm across (a kart fits, a car would not), sited where a real
      drain would be, lets a kart leave the track and roam the park's mown
      clearing, about 220 m in radius, out to a park fence before the belt
      of trees. The ground beyond the walls follows the habitat floor's
      real curve, rising about 5 m by the clearing's edge around the axis,
      as drivable physics and near detail. No off-track marker: a racer may
      have found a shortcut. Check colliders out there, shadow reach, dusk
      light, and the phone budget.
- [ ] 4.4.8: Detail pass, once the whole route is built. The finishes are
      flat colour with a fine grain, so pieces read as basic shapes: give
      concrete, steel, and paint real textures; bevel or detail the models
      whose silhouettes show (pipe flanges, door leaves, valve wheels,
      coping); and letter signs through textures, such as the tunnel's
      3.6 m clearance boards and its door numbers. Then an iPhone `?perf=1`
      run on the finished route, and the route in production: reset Falls
      View Park there to the finished seed with `db:reset-course-seed`, then
      an admin publishes it. If the phone run needs headroom, stop
      spraying hedges' unseen faces (about 38% of their sprays, against the
      ground, walls, and neighbours) and thin tree leaves at distance.
      Bring startup back within budget: PR 4.4.4's first frame is
      465–549 ms warm, about 30–110 ms over. Its new scans (concrete,
      gravel), decoded before the first frame, and the water and bicycle
      programs are the likely costs; measure before cutting.
      The downhill's crowd barriers are 583 of its objects and grow the
      bundled seed from 0.74 to 1.34 MB: merge each panel into fewer parts.
      Brace the landing deck's tall posts, and even out its banked rows'
      joints and the fill's seams beside it.
      Also steady the habitat's far-side street lamps (`lampLight` in
      `src/game/enclosure/habitat-glsl.ts`, PR 4.3.5), which draw as a
      crosshatch overhead and shimmer while driving, seen most clearly from
      Falls View Park's service ramp and levee climb, where the chase camera
      tilts up.

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
      Multiplayer results stay room-only. Decide whether runs that leave
      the track through Falls View Park's storm drain stay eligible.
- [ ] Progression tiers from Falls View Park best-time medals: a finish tier,
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
- [ ] Remove rough-course and Falls View Park assumptions from shared race
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
