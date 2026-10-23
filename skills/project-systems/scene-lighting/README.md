# Scene Lighting System

**Maturity:** Candidate (PR 4.1.2).

## Purpose And Scope

This system gives every PlayCanvas application one shared look: tone
mapping, exposure, habitat environment light, kart finish materials, and
shadow settings. It also owns the local `?perf=1` overlay that measures the
phone budget. Art direction and the budget itself live in
[`docs/visual-identity.md`](../../../docs/visual-identity.md).

## Source Ownership

- `src/game/render/scene-look.ts` applies Neutral tone mapping, sRGB gamma,
  exposure, and the habitat environment to an application and camera, and
  owns the shadow policy.
- `src/game/render/habitat-environment-atlas.ts` builds the environment atlas
  pixels on the CPU: the neutral habitat light once per page for editors and
  thumbnails, and a race's direction-aware light from its radiance.
- `src/game/enclosure/habitat-light.ts` computes the light Island Three sheds
  on a race's course, reused while races stay on one placement: radiance by
  direction for the atlas, and the fill light and sun glow the enclosure view
  shares.
- `src/game/kart/kart-visual-material.ts` owns the kart finishes (one
  material per finish) and the authored-color reflectance clamp that the
  [kart visual builder](../kart-builder/README.md) uses.
- `src/game/course/course-surface-materials.ts` owns the course finishes:
  one shader program whose diffuse override samples a CPU-built grain
  texture by world position, and a second for asphalt, turf, and lawn that
  samples their photo scans (colour, normal, and roughness) the same way.
  `course-surface-textures.ts` decodes the scans once per page; the home
  screen starts it, the race waits for it before its first frame, and the
  course editor switches to the scans when they arrive. If they fail, those
  surfaces keep the grain finish.
- `src/game/course/build-course-lighting.ts` lights a course with its
  enclosure's sun ([Island Three](../../../docs/island-three.md)) and sets its
  shadows (1024², 20 m coverage, a bias small enough for kart-scale shadows,
  and PCF5 filtering); the course
  editor widens coverage to 40 m for its overview.
- `src/game/kart/kart-contact-shadow.ts` lays the race-only contact shadow
  under the kart: one blended quad on the ground beneath the chassis, ordered
  above the course layers and faded by ground clearance.
- `src/game/kart/kart-surface-effects.ts` draws the race-only surface
  effects, each as one mesh with buffers allocated once and rewritten in
  place: bounded pools of mark quads where tires scrub sideways, one for
  asphalt and one for grass (the `tireMark` layer, between road paint and the
  contact shadow), and a bounded pool of ballistic clippings thrown by wheels
  on turf and lawn. Marks last until the race resets, and the oldest fade only
  as a full pool recycles them. Clippings move on simulated time, so they
  freeze while the race is paused.
- `src/game/enclosure/enclosure-view.ts` draws the race's
  [Island Three](../../../docs/island-three.md) enclosure from a second
  camera on its own layer, before the course, in three draws. Farmland,
  mirrors, the sun's image, and haze are computed per pixel, with no
  textures.
- `src/game/runtime/frame-budget.ts` and
  `src/components/frame-budget-overlay.tsx` sample rendered frames through
  `PlayCanvasRuntime.onFrameSample` and show the budget readout.

Callers: the race (`src/components/solo-time-trial-canvas.tsx`), the kart and
course editor scenes in `src/game/editor/`, and
`src/game/kart/kart-thumbnail-renderer.ts`.

## Invariants

- All four applications call `applySceneLook` and release it before
  `app.destroy()`.
- The enclosure's shell (floors, caps, and glass) is convex around the
  camera, so it draws without depth and cannot z-fight the course; only its
  frames depth-test, against each other. Its shaders include the engine's
  `gammaPS` and `tonemappingPS` chunks (`gammaCorrectOutput`, `toneMap`);
  re-verify them, like the chunk overrides below, on any engine upgrade.
- Playwright's server sets `NEXT_PUBLIC_TEST_WITHOUT_ENCLOSURE=1`, because
  CPU-rendered WebGL draws the enclosure at a few frames per second; tests
  that need it load the race with `?enclosure`. Production always draws it.
- The environment atlas replaces the scene's flat ambient light, so
  `scene.ambientLight` has no visible effect.
- The environment never renders as a skybox: `applySceneLook` removes the
  skybox layer from the camera.
- The atlas mirrors the PlayCanvas 2.20.6 `EnvLighting.generateAtlas` layout
  (512², RGBP, one-texel seams, v = 0 straight up), and its lookups mirror
  world X. Re-verify both against the engine's envAtlas shader chunks on any
  engine upgrade.
- A race's environment is in scene units (`skyboxIntensity` 1); the neutral
  habitat light keeps its gain. Its CPU build counts toward the startup
  budget ([measured](../../../docs/visual-identity.md#baseline)).
- The course finishes replace the `diffusePS` chunk (scanned finishes also
  `normalMapPS` and `glossPS`) for chunk version 2.20. Re-verify them, like
  the atlas, on any engine upgrade. Grain pixels and decoded scan images are
  kept, so both re-upload after a lost WebGL context. Scans load as image
  elements, not `ImageBitmap`s, which PlayCanvas avoids on Safari.
- CPU-built atlas pixels re-upload by themselves after a lost WebGL context.
  Do not switch to GPU prefiltering: it compiles extra shaders in every new
  application, and each kart thumbnail is one.
- Every kart color is an sRGB vertex color (`vertexColorGamma`, a documented
  option missing from the 2.20 typings), so all finishes share one shader
  program and the race kart batches to about one draw per finish per pass.
  Kart materials must stay free of per-part color or texture state.
- The race kart is one dynamic batch group. Batched parts are skinned, and
  PlayCanvas skins normals without the inverse-transpose, so parts stretched
  unevenly (springs, arms) shade slightly differently in the race than in the
  editor and thumbnails.
- Any change to the look, kart material, or thumbnail lighting changes kart
  thumbnails and must advance `KART_THUMBNAIL_RENDER_VERSION`
  ([kart thumbnails](../kart-thumbnails/README.md)).
- The overlay records only the racing state, publishes to React only when the
  race state changes, and never sends or stores data. The runtime reads and
  resets PlayCanvas's per-frame counters itself, because its fixed-step loop
  replaces the engine tick that normally resets them.

## Verification

- `tests/frame-budget.spec.ts` covers the summary math,
  `tests/course-lighting.spec.ts` covers course light projection, and
  `tests/habitat-light.spec.ts` covers the habitat light and the
  direction-aware atlas.
- `tests/home.spec.ts` WebGL loss/restore and thumbnail isolation tests,
  `tests/kart-thumbnail.spec.ts`, and the kart and course editor suites cover
  the shared look in each application.
- Phone budget measurement follows `docs/visual-identity.md`.

## Known Limits

- The habitat light uses the enclosure's mean surface colours, not its
  detail, and ignores the course's own geometry.
- Both atlas builders blur reflections with cos^power lobes, about half as
  wide as the engine's own GGX prefilter, and leave power 128 sharp, so
  mid-gloss finishes reflect a little sharply. Matching the engine would
  change every kart thumbnail.
- GPU time is not measured; shadow and fill cost show only through frame time.
