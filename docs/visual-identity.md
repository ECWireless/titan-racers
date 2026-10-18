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
- **Backgrounds stay flat clear colors** for now. The race sky is a stand-in
  until the Island Three enclosure renders (PR 4.3.1).

Neutral deepens the very darkest tones and their color. The near-black
identity should therefore come from light and backgrounds, not from
near-black surface colors. Today's asphalt and some kart colors are darker
than the real materials they represent. PRs 4.1.3 and 4.2.1 revisit them.

## Materials

- **Current baseline:** every kart part uses one coated, non-metallic finish
  on its authored color, a medium sheen like paint, anodizing, or powder
  coat.
- **Target for PR 4.1.3:** finishes follow what each part is made of: painted
  shells, bare or anodized metal hardware, and matte rubber tires. The
  direction leans industrial (matte powder coat, blasted metal) over clean
  hobby-grade gloss.

## Phone Performance Budget

The budget holds for all of Phase 4. Each PR that changes rendering reports
its measurements against it.

| Area | Budget |
| --- | --- |
| Target device | iPhone 16-class (A18). Android is not measured. |
| Frame time | 60 fps through a full two-lap race: median frame interval ≤ 17 ms, p95 ≤ 20 ms, at most 1 hitch over 50 ms after the countdown. |
| CPU work per frame | Median ≤ 5 ms (fixed steps, update, and render submit). |
| Draw calls | ≤ 250 per frame across all passes, and ≤ 30 per kart. |
| Shadows | One shadow-casting light with one 1024² PCF3 map, covering ≤ 40 m. Coil springs and dampers do not cast. |
| Resolution | 1× device pixels with MSAA. |
| Post-processing | None. |
| Startup | Race mount to first frame adds ≤ 300 ms over the "Before lighting" baseline below (63–136 ms warm). |

**Known overrun:** the current kart exceeds 30 draw calls because each coil
spring is built from 32 separate cylinders. PR 4.1.3 brings it under budget.

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

| Measure | Before lighting (PR 4.1.2 start) | After lighting baseline |
| --- | --- | --- |
| Frame p50 / p95 | 17.0 / 18.0 ms | 17.0 / 18.0 ms |
| CPU p50 / p95 | 3 / 4 ms | 3 / 4 ms |
| Draw calls p50 / max | 212 / 226 | 213 / 226 |
| First frame (warm) | 63–136 ms | 107–278 ms |
