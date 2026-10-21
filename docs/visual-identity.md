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

- **Habitat light.** Scenes are lit by a neutral, slightly warm environment:
  a bright diffuse horizon, a softer overhead, and a dark floor bounce. Courses
  add their own directional key and fill lights from the course document.
- **Courses control ambient strength, not color.** A course's ambient
  intensity scales the habitat light. Its ambient color has no visible effect
  until Island Three (PR 4.3.1) supplies light from the enclosure itself.
- **Neutral tone mapping.** Khronos PBR Neutral keeps the site's orange and
  hazard yellow on hue. ACES pushes them toward lemon yellow, and no tone
  mapping clips bright highlights.
- **No post-processing.** Tone mapping runs inside the main shader. There are
  no bloom, ambient-occlusion, or other full-screen passes.
- **Shadows reach the karts.** Race shadows cover the 20 m around the camera
  (the editor overview keeps 40 m) with a bias small enough for a 1:10 kart to
  shadow the ground beneath it. Course lights soften shadow edges over 5×5
  texels, because a kart spans only a few and a narrower filter lets its
  moving shadow flicker.
  Because the environment light is not occluded, the race also lays a soft
  contact shadow under the kart, where its chassis blocks surrounding light;
  it fades as the kart leaves the ground.
- **Backgrounds stay flat clear colors** for now. The race sky is a stand-in
  until the Island Three enclosure renders (PR 4.3.1).

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
  electronics, hinge-pin mounts, composite shock towers, a top deck, and
  molded bumpers. Lightening pockets wait for derivation support.

## Course Surfaces

- **Built for people.** Courses are habitat infrastructure at human scale:
  asphalt grain, paint widths, posts, and cabinets are full-size, so the 1:10
  karts read as tiny.
- **Service-yard finishes.** Aged mineral-grey asphalt (about 13%
  reflectance), clipped muted-olive turf bordering the road, darker and
  patchier uncut lawn beyond it, ice road paint for edge and start
  lines, hazard paint for kerbs, apexes, and grid accents, and steel for posts
  and cabinets.
- **Texture follows the world, not the piece.** A fine aggregate grain and a
  broad variation are generated in code and anchored to world position, so
  overlapping pieces and edited layouts stay continuous. Turf adds faint
  mowing stripes; lawn has none.
- **Flat where karts roll flat.** No grass blades, gravel, or bumps the
  physics does not have. Anything raised, such as a bridge, kicker, or table, is
  solid geometry with collision all the way to the ground.

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
| Shadows | One shadow-casting light with one 1024² map, covering ≤ 40 m. PCF5 filtering on course lights, PCF3 elsewhere. |
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

| Measure | Before lighting (PR 4.1.2 start) | After lighting baseline | Part visuals (PR 4.1.3) | Authored primitives (PR 4.1.4) | Sandbox surfaces (PR 4.2.1) | Surface physics (PR 4.2.2) | Collision substeps (PR 4.2.3) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Frame p50 / p95 | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0–19.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms | 17.0 / 18.0 ms |
| CPU p50 / p95 | 3 / 4 ms | 3 / 4 ms | 2 / 3 ms | 2 / 3 ms | 2 / 3–4 ms | 2 / 3 ms | 3 / 4 ms |
| Draw calls p50 / max | 212 / 226 | 213 / 226 | 38–39 / 55 | 38–39 / 51 | 34 / 45–46 | 35 / 48–49 | 35–36 / 46–49 |
| First frame (warm) | 63–136 ms | 107–278 ms | 121–128 ms | 132–191 ms | 335–392 ms | 133–207 ms | 136–282 ms |

PR 4.1.4 was measured with one race on each official kart rather than three
Balanced races. Each official kart is 15.3–15.5k triangles: 11.6k of part
visuals plus 3.7–3.8k of authored primitives (≤ 1,200 per primitive).

PR 4.2.1 was measured with three Balanced races, with no hitches. Its first
frame includes compiling the course finish and contact-shadow programs.

PR 4.2.2 was measured with three Balanced races on reloads, with no hitches.

PR 4.2.3 was measured with three Balanced races, with no hitches. Speed-adaptive
physics substeps (up to 4 Bullet steps per fixed step at racing speed) raised
CPU work by about 1 ms, still within the 5 ms median budget.
