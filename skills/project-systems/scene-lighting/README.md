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
  direction for the atlas, the fill light, air and sun glow the enclosure
  view shares, and how far a dim course adapts, its lamps are on, and its
  unlit effects (tire marks, drift smoke) dim.
- `src/game/kart/kart-visual-material.ts` owns the kart finishes (one
  material per finish) and the authored-color reflectance clamp that the
  [kart visual builder](../kart-builder/README.md) uses. Its two wheel
  finishes draw the tread, lettering, and spoke detail from each vertex's lathe station
  (UV1) and blur it per wheel: vertex alpha carries the wheel's index, and
  the race writes each wheel's swept angle into the materials' shared
  `kartWheelSweep` array every frame (`src/game/kart/kart-wheel-spin.ts`
  sets the spin).
- `src/game/course/course-surface-materials.ts` owns the course finishes:
  one shader program whose diffuse override samples a CPU-built grain
  texture by world position, and a second for asphalt, turf, and lawn that
  samples their photo scans (colour, normal, and roughness) the same way.
  `course-surface-textures.ts` decodes the scans once per page; the home
  screen starts it, the race waits for it before its first frame, and the
  course editor switches to the scans when they arrive. If they fail, those
  surfaces keep the grain finish.
- `src/game/course/course-lamps.ts` puts a floodlight's arm, luminaire,
  and downward spot light on each `lamp` object's mast, at real brightness
  from the enclosure's lux scale and the habitat's lamp schedule, with no
  shadows, and measures the illuminance they put on the track, which the
  race's exposure counts. The race batches the lamp parts with the static
  course; the editor shows them switched off.
- `src/game/course/course-interior.ts` lights a course's indoors: an
  interior environment atlas built by elevation from the light a lamp-lit
  service tunnel's floor, walls, and ceiling give back
  (`COURSE_INTERIOR_EXITANCE`), the test for whether a point lies beneath an
  overhead indoor object (a roof), and the race kart's switch between outdoor
  and indoor light. `createCourseSurfaceMaterials` builds a second set of
  finishes lit by that atlas when given it, and `buildRoughCourse` gives them
  to indoor objects (`keepCourseVisualIndoors`).
- `src/game/course/build-course-lighting.ts` lights a course with its
  enclosure's sun ([Island Three](../../../docs/island-three.md)). Its
  colour carries its brightness at intensity 1, as the lamps' do, because
  PlayCanvas applies intensities below 1 before linearising the colour. It
  sets its shadows: two 1024² cascades in one 2048² map out to 60 m, blended over
  the near cascade's last fifth, a bias small enough for kart-scale shadows,
  and PCF5 filtering. `scene-look.ts` fades cascaded shadows over their
  last fifth by patching the `shadowCascadesPS` and `lightFunctionLightPS`
  chunks, which leaves single-map lights (the kart editor and thumbnails) as
  they were.
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
  camera on its own layer, before the course, in seven draws: frames and
  structures, trees, buildings, the shell with the course valley's relief,
  the glass, the translucent falls, and the distant lights at dusk
  (`distant-lights.ts`: additive discs at least a pixel wide that keep each
  light's total, dimmed by the haze, placed on the land like the trees).
  Valley land, relief shading, mirrors, the sun's image, and haze are
  computed per pixel, with no
  textures; the relief's height comes from the same GLSL in the vertex
  shaders. Trees are instanced
  [billboards](../../../docs/visual-identity.md#tree-billboards) that turn
  about their own up toward the camera, blending the two nearest baked
  views, and join once their atlases load; the home screen starts decoding
  them.
- `src/game/enclosure/enclosure-structures.ts` builds the end caps'
  terraces, elevators, and hubs, and the falls bridge into the frames' mesh,
  and the instanced trees and buildings, placed by
  `src/game/enclosure/habitat-land.ts`, a CPU mirror of the land GLSL.
  They are laid out after the race's first frame, usually behind the
  loading screen; the kart editor's test drive has no loading screen, and a
  slow load can show the hitch during its fade.
- `src/game/enclosure/exterior-view.ts` draws Island Three from space for
  the course loading screen (`src/components/course-loading-screen.tsx`):
  raw WebGL2 on its own canvas, one full-screen shader that traces the hull,
  mirrors, and Saturn and repeats the scene look's Neutral tone mapping and
  its base exposure, unadapted, since it looks on from sunlit space, and
  shows the habitat by day (mirrors at most 80°).
  `src/game/enclosure/habitat-glsl.ts` holds the land, cap, mirror-light,
  and distant-lamp GLSL it shares with the enclosure view.
- `src/game/runtime/frame-budget.ts` and
  `src/components/frame-budget-overlay.tsx` sample rendered frames through
  `PlayCanvasRuntime.onFrameSample` and show the budget readout, with the
  loading screen's cover, race-ready, and reveal times from the tap.

Callers: the race (`src/components/solo-time-trial-canvas.tsx`), the kart and
course editor scenes in `src/game/editor/`, and
`src/game/kart/kart-thumbnail-renderer.ts`.

## Invariants

- All four applications call `applySceneLook` and release it before
  `app.destroy()`.
- The enclosure keeps its own depth range, cleared before the course
  draws, so it never z-fights the course. Within it, everything inside the
  shell depth-tests normally: frames, structures, trees, buildings, and the
  course valley's relief. The rest of the shell (the other floors, the caps,
  and the glass) is convex around the camera, so it pins its depth to the
  far plane and draws last, behind everything inside it. Its shaders include
  the engine's `gammaPS` and `tonemappingPS` chunks (`gammaCorrectOutput`,
  `toneMap`); re-verify them, like the chunk overrides below, on any engine
  upgrade.
- Playwright's server sets `NEXT_PUBLIC_TEST_WITHOUT_ENCLOSURE=1`, because
  CPU-rendered WebGL draws the enclosure at a few frames per second; it also
  skips the loading screen (`drawsEnclosure`). Tests that need either load
  the race with `?enclosure`. Production always draws both.
- The loading screen's view uses its own WebGL context, created per screen
  and lost on dispose, so the race's context is unaffected. Its tone mapping
  copies `toneMap` by hand: re-verify it against the engine's Neutral chunk,
  and keep `EXPOSURE` shared, on any engine or look change. If its shader
  fails or its context is lost, the screen falls back to plain near-black
  and the race still loads.
- The environment atlas replaces the scene's flat ambient light, so
  `scene.ambientLight` has no visible effect.
- Indoors and outdoors are separated by light masks. PlayCanvas 2.20.6's
  clustered lighting honours only two channels: a mesh whose mask includes
  `MASK_AFFECT_DYNAMIC` takes only lights flagged dynamic, any other mesh
  only lights flagged `MASK_AFFECT_LIGHTMAPPED`; directional lights filter by
  the bitwise mask. Outdoor meshes, the sun, and floodlights keep the default
  dynamic mask; indoor meshes take `MASK_AFFECT_LIGHTMAPPED` and cast no sun
  shadow; lights meant to reach both, like a tunnel's lamps, take both bits.
  Assigning a render component's mesh instances resets their masks
  (`setLightmapped`), so masks are set after the visual exists. A mask is
  part of the shader variant.
- A material's own `envAtlas` bypasses the scene's `skyboxIntensity`, so the
  interior atlas, stored brightened by the adaptation like the habitat's,
  is scaled back by the material's `ambient` (a linear gain, stored as sRGB)
  and `reflectivity` (`applyAdaptedEnvironmentAtlas`). On a course with an
  inside, the race kart's finishes hold the habitat's atlas themselves the
  same way, so crossing a portal swaps only the atlas texture and the mask. The kart is a dynamic batch, whose batches clone their materials and
  copy masks when built, so the switch changes the originals and the current
  batches (`BatchManager.getBatches`, typed private in 2.20.6). While the
  loading screen covers it, its first frames light it both ways once, so a
  portal compiles nothing mid-race. Re-verify these against the engine on upgrade.
- Indoor and outdoor surfaces meet edge to edge at a portal, never
  overlapping: coplanar layers lit differently would flicker.
- The environment never renders as a skybox: `applySceneLook` removes the
  skybox layer from the camera.
- The race camera reports its frustum corners at its widest view
  (`steadyShadowFit`), so sun shadows keep one size, and hold still, while
  the chase camera widens with speed. PlayCanvas 2.20.6 reads frustum
  corners only to fit directional shadows; re-verify that on any engine
  upgrade.
- The atlas mirrors the PlayCanvas 2.20.6 `EnvLighting.generateAtlas` layout
  (512², RGBP, one-texel seams, v = 0 straight up), and its lookups mirror
  world X. Re-verify both against the engine's envAtlas shader chunks on any
  engine upgrade.
- A race's environment is in scene units. A dim course's atlas is stored
  brightened by its adaptation, with `skyboxIntensity` its inverse and the
  exposure raised by it, so dusk keeps its precision in the 8-bit atlas; the
  neutral habitat light keeps its gain. Its CPU build counts toward the startup
  budget ([measured](../../../docs/visual-identity.md#baseline)).
- The course finishes replace the `diffusePS` chunk (scanned finishes also
  `normalMapPS` and `glossPS`), the wheel finishes `diffusePS`, `glossPS`,
  `metalnessPS`, and the `litUser*` hooks, and the cascaded-shadow fade patches
  `shadowCascadesPS` and `lightFunctionLightPS`, for chunk version 2.20; the
  fade throws if its anchor text is gone. Re-verify them, like
  the atlas, on any engine upgrade. Grain pixels and decoded scan images are
  kept, so both re-upload after a lost WebGL context. Scans load as image
  elements, not `ImageBitmap`s, which PlayCanvas avoids on Safari.
- CPU-built atlas pixels re-upload by themselves after a lost WebGL context.
  Do not switch to GPU prefiltering: it compiles extra shaders in every new
  application, and each kart thumbnail is one.
- Every kart color is an sRGB vertex color (`vertexColorGamma`, a documented
  option missing from the 2.20 typings), so all finishes but the two wheel
  finishes share one shader program, and the race kart batches to about one
  draw per finish per pass.
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
  detail: its terraces lie flat on the caps, its hills are left out, and the
  trees around the clearing are a band of mean cover. It ignores the
  course's own geometry.
- Both atlas builders blur reflections with cos^power lobes, about half as
  wide as the engine's own GGX prefilter, and leave power 128 sharp, so
  mid-gloss finishes reflect a little sharply. Matching the engine would
  change every kart thumbnail.
- GPU time is not measured; shadow and fill cost show only through frame time.
- One exposure serves the whole race, set for the outdoor course: by day an
  interior lit like a dusk tunnel is several stops darker than the sunlit
  course. Unlit effects (tire marks, drift smoke) keep the outdoor light level
  indoors.
- Indoor surfaces never take sunlight, so a low sun cannot reach the first
  metres inside a portal.
