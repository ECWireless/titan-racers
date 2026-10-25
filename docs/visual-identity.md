# Titan Racers Visual Identity

This document is the art direction for every rendered scene: karts, courses,
the Island Three enclosure, editors, and thumbnails. Each Phase 4 PR refines
it. It also owns the phone performance budget that every scene must hold.

How the look is implemented lives in the
[scene lighting](../skills/project-systems/scene-lighting/README.md) system.

## Principles

- **One identity, not plain realism.** Every visual should read as the same
  world. Photorealism alone produces a generic look.
- **Light and materials behave physically.** Surfaces respond to light the way
  real materials do, and visuals never misrepresent the physics, such as
  wheels steering past their real angle.
- **1:10 RC scale.** Karts are small hobby machines in a huge habitat. Detail
  and wear should read at that scale.
- **The site palette is the anchor.** In-world color starts from the Titan
  Racers site palette.
- **Demo-sized.** Code-built geometry, CC0 textures, and reviewed repository
  models. Pull back if the work drifts toward production art.

## Palette

The site tokens live in `src/app/globals.css`.

| Token | Hex | Role in the world |
| --- | --- | --- |
| Titan black | `#070706` | Base darkness: editor and thumbnail backgrounds, deep shadow. |
| Panel | `#14120f` | Dark structural surfaces. |
| Ice | `#f7f2e8` | Light markings and lettering. |
| Muted | `#b8afa1` | Worn light surfaces. |
| Orange | `#ff7a18` | Primary signal: hazards, active parts, key accents. |
| Hazard | `#ffbd59` | Floor markings and caution striping. |
| Rust | `#bd482d` | Weathering and secondary warning color. |
| Steel | `#34404a` | Machinery, frames, and technical surfaces. |
| Blue | `#42a5ff` | Rare technical accent, such as indicators. |

Orange and hazard are signals. Use them sparingly so they stay readable.

## Light

- **Habitat light.** A race is lit by what surrounds its course in Island
  Three: sunlit and shaded floors, windows, and haze, so a kart is brighter
  on the side facing the sunlit floor. The habitat is dim next to Earth's
  sky, so shade is deep and sunlight carries the scene. Editors and
  thumbnails use a neutral, slightly warm environment: a bright diffuse
  horizon, a softer overhead, and a dark floor bounce.
- **Sunlight comes through Island Three's windows.** A course does not aim
  its own lights. Its mirror angle sets the time of day, and the sun shines
  from the window opposite its valley ([Island Three](island-three.md)).
- **Neutral tone mapping.** Khronos PBR Neutral keeps the site's orange and
  hazard yellow on hue. ACES pushes them toward lemon yellow, and no tone
  mapping clips bright highlights.
- **No post-processing.** Tone mapping runs inside the main shader. There are
  no bloom, ambient-occlusion, or other full-screen passes.
- **Shadows reach the karts.** Sun shadows cover the 60 m ahead of the camera
  in two cascades: a sharp one to about 16 m, blended into a coarser one
  beyond, which fades out over its last 12 m rather than ending at an edge.
  Their bias is small enough for a 1:10 kart to shadow the ground beneath it,
  and they keep one size as the chase camera widens with speed, so static
  shadows hold still. Course lights soften shadow edges over 5×5
  texels, because a kart spans only a few and a narrower filter lets its
  moving shadow flicker.
  Because the environment light is not occluded, the race also lays a soft
  contact shadow under the kart, where its chassis blocks surrounding light;
  it fades as the kart leaves the ground.
- **The race is surrounded by Island Three,** self-lit, shaded by its
  sunlight, and softened by distance haze so its kilometres read
  ([Island Three](island-three.md#rendering)). Editors and thumbnails keep
  flat clear colors.
- **Races load in space.** The loading screen shows Island Three from
  outside, lit by the same sun and tone mapping as the race, against black
  space and Saturn ([Island Three](island-three.md#from-outside)). The site's
  near-black frames the course name below it.

Neutral deepens the very darkest tones and their color. The near-black
identity should therefore come from light and backgrounds, not from
near-black surface colors. Kart colors render within real reflectance (see
Materials), and so do course surfaces (see Course Surfaces).

## Materials

- **Industrial finishes.** Finishes follow what each part is made of: matte
  powder coat and paint, anodized and bead-blasted aluminum, machined and
  black-oxide steel, molded plastic, copper, and matte rubber. Not clean
  hobby-grade gloss.
- **Authored color goes on coated surfaces.** A part's chosen color shows on
  its paint, anodizing, or dyed plastic. Hardware, heatsinks, wires, and tires
  keep their real colors.
- **Colors stay within real reflectance.** Authored colors render with their
  hue kept but their lightness clamped to about 4% (black paint) to 85%
  (white paint) reflectance. Documents keep the authored value.
- **Parts look like real 1:10 RC parts.** Each approved part version has a
  code-built visual that matches its registry dimensions. Wheels look the same
  at any angle, because the physics has no wheel spin.
- **Authored primitives read as RC construction.** Role picks the form:
  machined plates (detail on their largest face, so upright shock towers work
  too), molded shells with vents and panel lines, ribbed bumpers, chamfered
  trim, and screwed-down steel ballast. Material picks machined chamfers or
  molded radii. Screws, ribs, and vents keep fixed real sizes and multiply
  with size; everything stays inside the authored envelope, and nothing
  implies missing material (no pockets or holes).
- **Official karts are open 1:10 RC chassis.** A machined plate carries the
  electronics, composite hinge-pin mounts deep enough for both arm legs,
  composite shock towers (a post and a crossbar above the steered wheels), a
  top deck, and molded bumpers. Shocks lean 30°, a typical 1:10 installation.
  Lightening pockets wait for derivation support.

## Course Surfaces

- **Built for people.** Courses are habitat infrastructure at human scale:
  asphalt grain, paint widths, posts, and cabinets are full-size, so the 1:10
  karts read as tiny.
- **Service-yard finishes.** Aged mineral-grey asphalt (about 13%
  reflectance), clipped muted-olive turf bordering the road, darker and
  patchier uncut lawn beyond it, ice road paint for edge and start
  lines, hazard paint for kerbs, apexes, and grid accents, and steel for posts
  and cabinets.
- **Asphalt and grass are photo scans at true size.** CC0 scans give their
  aggregate, blades, relief, and roughness variation, recoloured and re-glossed
  so each surface keeps its palette colour and sheen on average. Turf mowing stripes depend on viewing
  direction, as real ones do: a band looks lighter when its blades lean away
  from the viewer.
- **Texture follows the world, not the piece.** Scans and a code-built broad
  variation are anchored to world position, so overlapping pieces and edited
  layouts stay continuous. Paint, steel, and other finishes keep a fine
  code-built grain.
- **Flat where karts roll flat.** No raised grass blades, gravel, or bumps the
  physics does not have; grass relief is shading on the flat surface. Anything
  raised, such as a bridge, kicker, or table, is solid geometry with collision
  all the way to the ground.
- **Surfaces show how karts drive on them.** Tires sliding sideways lay
  marks that last for the race: dark rubber on asphalt and fainter torn turf
  on grass. Wheels on turf and lawn throw real-size clippings, more when they
  slide, which fly under real gravity. All follow the actual tire contact and
  slip.

### Surface Scans

From [ambientCG](https://ambientcg.com) (CC0), 1K sets in
`src/game/course/surface-textures/`, each packed into two JPEGs: colour as a
ratio to the scan's mean with 80% of its ambient occlusion baked in, and the
OpenGL normal's x and y with roughness.

| Surface | Scan | Drawn at |
| --- | --- | --- |
| Asphalt | Asphalt030 | 2.2 m |
| Uncut lawn | Grass001 | 1.4 m |
| Turf | Grass004 | 0.8 m (scanned at 1.4 m) |

### Tree Billboards

The enclosure's trees are billboards baked from [Poly Haven](https://polyhaven.com)
scans (CC0) by `scripts/bake-tree-billboards.ts`: Island Tree 01 and 02,
Jacaranda Tree, and Fir Tree 01, each seen from eight directions at 256 px,
in `src/game/enclosure/tree-textures/`: an opaque colour atlas, and a shape
atlas of view-space normals and the leaves' coverage, so the habitat's sun
lights each tree from its side. Firs are darkened toward needles in the
race.

## Phone Performance Budget

The budget holds for all of Phase 4. Each PR that changes rendering reports
its measurements against it.

| Area | Budget |
| --- | --- |
| Target device | iPhone 16-class (A18). Android is not measured. |
| Frame time | 60 fps through a full two-lap race: median frame interval ≤ 17 ms, p95 ≤ 20 ms, at most 1 hitch over 50 ms after the countdown. |
| CPU work per frame | Median ≤ 5 ms (fixed steps, update, and render submit). |
| Draw calls | ≤ 250 per frame across all passes, and ≤ 30 per kart. |
| Triangles | ≤ 20k per kart (soft cap). |
| Shadows | One shadow-casting light with one 2048² map holding two 1024² cascades, covering ≤ 60 m. PCF5 filtering on course lights, PCF3 elsewhere. |
| Resolution | 1× device pixels with MSAA. |
| Post-processing | None. |
| Startup | Race mount to first frame adds ≤ 300 ms over the "Before lighting" baseline below (63–136 ms warm). |

### How To Measure

1. Serve a production build (`pnpm build` and `pnpm start`) and open the race
   with `?perf=1`.
2. On the reference iPhone, race the Balanced kart through a full two-lap race
   on the sandbox course, three times.
3. Read the overlay on the results screen. It records only the racing state
   and sends nothing anywhere.
4. Measure startup with page reloads rather than **Race again**, and ignore
   the first, cold load after a new build.

Safari caps the race at 60 fps, so frame time does not show spare capacity.
CPU work and draw calls are the headroom signals.

### Baseline

| Measure | Before lighting (PR 4.1.2 start) | After lighting baseline | Part visuals (PR 4.1.3) | Authored primitives (PR 4.1.4) | Sandbox surfaces (PR 4.2.1) | Surface physics (PR 4.2.2) | Collision substeps (PR 4.2.3) | Surface effects (PR 4.2.4) | Surface scans (PR 4.2.5) | Handbrake clutch (PR 4.2.6) | Island Three (PR 4.3.1) | Habitat physics (PR 4.3.2) | Loading screen (PR 4.3.3) | Valley structures (PR 4.3.4) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Frame p50 / p95 | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0–19.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms |
| CPU p50 / p95 | 3 / 4 ms | 3 / 4 ms | 2 / 3 ms | 2 / 3 ms | 2 / 3–4 ms | 2 / 3 ms | 3 / 4 ms | 2 / 3–4 ms | 2–3 / 4 ms | 2 / 3 ms | 2 / 3 ms | 2 / 3–4 ms | 2 / 3 ms | 3 / 4 ms |
| Draw calls p50 / max | 212 / 226 | 213 / 226 | 38–39 / 55 | 38–39 / 51 | 34 / 45–46 | 35 / 48–49 | 35–36 / 46–49 | 36–37 / 49–51 | 37–39 / 49–51 | 36–37 / 49–50 | 30–31 / 41 | 31–32 / 41–42 | 30–32 / 41 | 44–45 / 55–58 |
| First frame (warm) | 63–136 ms | 107–278 ms | 121–128 ms | 132–191 ms | 335–392 ms | 133–207 ms | 136–282 ms | 147–230 ms | 240–243 ms | Not measured | 259 ms | 352–433 ms | 289–295 ms | 302–575 ms |

PR 4.1.4 was measured with one race on each official kart rather than three
Balanced races. Each official kart is 15.3–15.5k triangles: 11.6k of part
visuals plus 3.7–3.8k of authored primitives (≤ 1,200 per primitive).

PR 4.2.1 was measured with three Balanced races, with no hitches. Its first
frame includes compiling the course finish and contact-shadow programs.

PR 4.2.2 was measured with three Balanced races on reloads, with no hitches.

PR 4.2.3 was measured with three Balanced races, with no hitches. Speed-adaptive
physics substeps (up to 4 Bullet steps per fixed step at racing speed) raised
CPU work by about 1 ms, still within the 5 ms median budget.

PR 4.2.4 was measured with three Balanced races and a reloaded confirmation
race, with no hitches. Course shadows filter over 5×5 texels, and tire marks
and grass clippings add at most three draw calls (asphalt marks, grass marks,
clippings).

PR 4.2.5 was measured with three Balanced races on reloads, with no hitches.
The scanned finishes add no draw calls; their first frame includes decoding
and uploading about 3 MB of surface scans. The first load after a new build
took 736 ms.

PR 4.2.6 was measured with three Balanced races using **Race again**, with no
hitches. The handbrake drive cut adds no measurable CPU work. Warm first frame
was not remeasured; the first load after a new build took 789 ms.

PR 4.3.1 was measured with three Balanced races on reloads, with no hitches,
on the Agricultural Zone's small starter loop, which has fewer course draws
than the sandbox. The Island Three enclosure adds three draw calls and about
22k triangles; its per-pixel farmland, mirrors, and haze add no measurable
frame time. Computing the race's habitat light on the CPU adds about
25–40 ms to the first frame. The first load after a new build took 556 ms,
with two hitches; warm races had none.

PR 4.3.2 was measured with three Balanced races on reloads, with no hitches,
on the Agricultural Zone. Habitat gravity and Coriolis add no measurable CPU
work. The re-laid-out official axles (deep hinge-pin mounts and two tower
crossbars) bring each official kart to 16.1–16.3k triangles: 11.6k of part
visuals plus 4.5–4.7k of authored primitives. Warm first frames ran
352–433 ms (279–425 ms on an earlier build of this PR) against 259 ms for
PR 4.3.1, varying run to run with no change to startup work; near the
budget's top, so worth watching.

PR 4.3.3 was measured with three Balanced races on reloads, with no hitches,
on the Agricultural Zone. The loading screen draws only until the race shows,
fading out over the countdown's first 300 ms, so racing costs are unchanged. It painted its
first frame 28–29 ms after the tap (268 ms on the first run, which compiled
its shader), the race was ready after 371–914 ms, and every race showed at
the 2.5 s minimum. The first run's race first frame took 425 ms.

PR 4.3.4 was measured with three Balanced races on reloads, with no hitches,
on Falls View Park, which now takes the sandbox's layout, so it has more
course draws than the Agricultural Zone's starter loop. The enclosure's hills,
trees, town buildings, end-cap terraces, elevators, and falls bridge add
two draw calls and about 50k triangles, and the translucent falls one more,
with no measurable frame time. Races were ready after 429–707 ms, and every
race showed at the 2.5 s minimum.
