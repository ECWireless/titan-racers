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
  exposure, and the habitat environment to an application and camera, scales
  it by the course's ambient intensity, and owns the shadow policy.
- `src/game/render/habitat-environment-atlas.ts` builds the environment atlas
  pixels on the CPU, once per page.
- `src/game/kart/kart-visual-material.ts` owns the kart finishes (one
  material per finish) and the authored-color reflectance clamp that the
  [kart visual builder](../kart-builder/README.md) uses.
- `src/game/course/course-surface-materials.ts` owns the course finishes:
  one shader program whose diffuse override samples a CPU-built grain
  texture by world position.
- `src/game/course/build-course-lighting.ts` sets the course shadow presets
  (20 m coverage, a bias small enough for kart-scale shadows, and PCF5
  filtering); the course
  editor widens coverage to 40 m for its overview.
- `src/game/kart/kart-contact-shadow.ts` lays the race-only contact shadow
  under the kart: one blended quad on the ground beneath the chassis, ordered
  above the course layers and faded by ground clearance.
- `src/game/runtime/frame-budget.ts` and
  `src/components/frame-budget-overlay.tsx` sample rendered frames through
  `PlayCanvasRuntime.onFrameSample` and show the budget readout.

Callers: the race (`src/components/solo-time-trial-canvas.tsx`), the kart and
course editor scenes in `src/game/editor/`, and
`src/game/kart/kart-thumbnail-renderer.ts`.

## Invariants

- All four applications call `applySceneLook` and release it before
  `app.destroy()`.
- The environment atlas replaces the scene's flat ambient light, so
  `scene.ambientLight` has no visible effect. The course ambient color is
  ignored; its intensity sets `skyboxIntensity`.
- The environment never renders as a skybox: `applySceneLook` removes the
  skybox layer from the camera.
- The atlas mirrors the PlayCanvas 2.20.6 `EnvLighting.generateAtlas` layout
  (512², RGBP, one-texel seams, v = 0 straight up). Re-verify it against the
  engine's envAtlas shader chunks on any engine upgrade.
- The course finishes replace the `diffusePS` chunk for chunk version 2.20.
  Re-verify it, like the atlas, on any engine upgrade. Their grain pixels
  are also CPU-built and re-upload after a lost WebGL context.
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

- `tests/frame-budget.spec.ts` covers the summary math, and
  `tests/course-lighting.spec.ts` covers course light projection.
- `tests/home.spec.ts` WebGL loss/restore and thumbnail isolation tests,
  `tests/kart-thumbnail.spec.ts`, and the kart and course editor suites cover
  the shared look in each application.
- Phone budget measurement follows `docs/visual-identity.md`.

## Known Limits

- The habitat environment is a stand-in until the Island Three enclosure
  (PR 4.3.1) supplies its own light.
- GPU time is not measured; shadow and fill cost show only through frame time.
