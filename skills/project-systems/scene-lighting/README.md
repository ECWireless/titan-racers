# Scene Lighting System

**Maturity:** Candidate (PR 4.1.2).

## Purpose And Scope

This system gives every PlayCanvas application one shared look: tone
mapping, exposure, habitat environment light, kart material baseline, and
shadow settings. It also owns the local `?perf=1` overlay that measures the
phone budget. Art direction and the budget itself live in
[`docs/visual-identity.md`](../../../docs/visual-identity.md).

## Source Ownership

- `src/game/render/scene-look.ts` applies Neutral tone mapping, sRGB gamma,
  exposure, and the habitat environment to an application and camera, scales
  it by the course's ambient intensity, and owns the shadow policy.
- `src/game/render/habitat-environment-atlas.ts` builds the environment atlas
  pixels on the CPU, once per page.
- `src/game/kart/kart-visual-material.ts` is the one kart material the
  [kart visual builder](../kart-builder/README.md) receives from every caller.
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
- CPU-built atlas pixels re-upload by themselves after a lost WebGL context.
  Do not switch to GPU prefiltering: it compiles extra shaders in every new
  application, and each kart thumbnail is one.
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
- The course editor's ambient color control has no visible effect until then.
- GPU time is not measured; shadow and fill cost show only through frame time.
