# PlayCanvas Course Editing

**Maturity:** Validated. The PlayCanvas 2.20.6 course mapping, runtime migration,
and browser regression gates passed for PR 2.3.1 on 2026-07-11.

## Purpose And Scope

This node maps the engine-independent
[`course-editing`](../../../game-concepts/course-editing/README.md) standard to
the pinned PlayCanvas Engine and existing Ammo integration. Read it before
changing course construction, primitive mapping, physics roles, editor/runtime
identity, fixture gating, course-light mapping, or collision debug rendering.

It inherits application lifecycle, fixed-step, rigid-body, and teardown rules
from the parent [`PlayCanvas and Ammo`](../README.md) node and course collision
policy from [`collisions`](../collisions/README.md).

## Ownership Boundary

Validate and normalize the plain course document before calling PlayCanvas.
The builder receives a validated document plus repository-owned material
instances and returns runtime lookup maps. It must not mutate the document.

Use stable document IDs as entity names and lookup keys. PlayCanvas entities and
GUIDs are runtime projections only; never write them back into course data.

## Primitive Mapping

Version one maps visual primitives as follows:

- document `box` to a PlayCanvas box model;
- document `cylinder` to a PlayCanvas cylinder model; and
- semantic material keys to the existing repository-owned material palette.

Map collision unions independently:

- box half-extents, local position offset, and local Euler rotation to the box
  collision component;
- cylinder radius, height, axis, local position offset, and local Euler rotation
  to the cylinder collision component.

PlayCanvas supports these primitive collision parameters directly, including
offsets and axes:
<https://developer.playcanvas.com/user-manual/editor/scenes/components/collision/>.

Do not infer an authored collider from render scale inside the engine adapter.
The seed may deliberately use matching values, but visual and physical geometry
remain separate authored inputs.

## Lighting Mapping

Multiply the validated ambient RGB color by its bounded intensity and assign
the result to `app.scene.ambientLight`. Map each validated directional-light
record to one PlayCanvas directional light entity named by its stable authored
ID. Apply color, intensity, and Euler rotation directly.

Map the portable shadow presets to fixed renderer settings: off disables shadow
casting, while low/medium/high use 512/1024/2048 resolution respectively. Keep
the accepted bias and distance inside the adapter rather than exposing raw
renderer tuning in the portable course contract.

## Semantic Physics Roles

Map `drivable-surface` to the existing drivable tag, physics group/mask,
friction, and zero-restitution static-body policy. Map `solid-obstacle` to the
existing obstacle tag, solid group/mask, friction, and zero-restitution static
policy.

Objects without collision data receive no collision or rigid-body component.
Checkpoint volumes are document data in PR 2.3.1 and do not become triggers until
race progression owns their lifecycle.

Keep diagnostic availability explicit. Standard objects build in ordinary play;
collision-test fixtures build only when the existing non-production test hook
and deliberate route opt-in both permit them.

## Construction And Failure

1. Parse unknown JSON with the canonical runtime schema.
2. Reject the complete load before PlayCanvas scene mutation on any validation
   failure.
3. Create standard objects in deterministic document order.
4. Create permitted diagnostic objects only when explicitly enabled.
5. Return stable-ID maps required by editor selection, collision diagnostics,
   camera tests, and teardown.
6. Destroy all constructed entities through the existing application lifecycle.

No partial best-effort course is permitted.

## Collision Visualization Mapping

PR 2.3.3 should visualize the document's authoritative collision union rather than
querying or copying Ammo shapes. Boxes can be rendered from half-extents and
local offsets; cylinders from radius, height, axis, and offsets. Use dedicated
debug materials or PlayCanvas immediate lines without physics participation.

PlayCanvas `Application.drawLine` and related immediate-line methods accept
world-space points and optional depth testing:
<https://api.playcanvas.com/engine/classes/Application.html#drawLine>.

The visualization must update from the same in-memory document command that
updates runtime collision geometry and must never become a selectable physical
object itself.

## Open-Source Editor Reference

PR 2.3.3 research reviewed the MIT-licensed PlayCanvas Editor frontend as a
reference implementation. Reuse the pinned Engine's maintained APIs directly
instead of copying the complete Editor architecture:

- `TranslateGizmo`, `RotateGizmo`, and `ScaleGizmo` provide transform lifecycle
  events suitable for one command per completed gesture;
- `Picker` provides viewport selection without inventing a parallel hit-test
  model;
- picking should pause while a transform handle owns the pointer; and
- transform mode, local/world coordinates, snapping, focus, undo, and redo
  should remain explicit toolbar actions with keyboard equivalents.

The upstream Editor's hierarchy/viewport/inspector layout and collapsed
narrow-screen panels are useful interaction references. Its Observer, PCUI,
collaboration, asset, and general scene-graph systems are deliberately not part
of Titan Racers: this application already owns a React shell, a bounded course
document, immutable database revisions, and a narrower command history.

PlayCanvas also distinguishes continuously saved editable project state from a
published playable build and lets an operator promote one build to the primary
audience-facing version. Titan Racers adopts that product boundary without
copying PlayCanvas hosting: Save Draft creates an application-owned private
revision, while a later protected Publish operation promotes one saved revision
to the guest runtime. Download Backup remains portable-document recovery rather
than a synonym for publishing.

Titan Racers guest construction now resolves the explicit current guest course,
validates its privacy-minimized published response, and passes that portable
document into the same `buildRoughCourse` and `buildCourseLighting` projections.
The renderer never reads a mutable database draft or publication metadata and
contains no player-facing editor mode. Runtime mutation fixtures are exposed
only through the non-production scene test adapter.

Primary references:

- <https://github.com/playcanvas/editor>
- <https://github.com/playcanvas/editor/blob/main/src/editor/viewport/gizmo/gizmo-transform.ts>
- <https://github.com/playcanvas/editor/blob/main/src/editor/viewport/viewport-pick.ts>
- <https://github.com/playcanvas/editor/blob/main/src/editor/layout/layout.ts>
- <https://github.com/playcanvas/editor/blob/main/src/editor/toolbar/toolbar-history.ts>
- <https://developer.playcanvas.com/user-manual/editor/>
- <https://developer.playcanvas.com/user-manual/editor/publishing/web/playcanvas-hosting/>

## Implemented Authoring Mapping

The protected editor uses PlayCanvas 2.20.6 as a visual projection without
creating editor-only physics bodies. `Picker` resolves editable rendered nodes
and the collision diagnostic projection back to stable document selections.
`TranslateGizmo`, `RotateGizmo`, and a shape-aware `ScaleGizmo` attach to the
current projection. A completed gesture reads the runtime transform once,
validates the resulting portable document, and adds one command to
application-owned history. Start uses an exact authored-transform root with its
raised visual marker on a child, preventing presentation offsets from entering
spawn data during any gizmo edit.

The shipped adapter uses maintained `TransformGizmo.snap` and per-tool
`snapIncrement` values: 0.25 meters for translation, 5 degrees for rotation,
and 0.1 for scale steps. Boxes and checkpoints retain independent axis handles;
their visual scale, box half-extents, and collision offset update component by
component. Cylinders expose their height axis plus the maintained gizmo's radial
plane, with `uniform = true` on that plane so both radial visual axes continue
to match the portable collision radius. Inspector controls apply the same
shape-specific rules without a precision drag.

Shape-aware scaling keeps visual and collision meaning coherent: box
half-extents and offsets scale on the corresponding axis, while cylinder height
is independent from its paired radial dimensions. Elliptical cylinder scaling
remains unavailable because the portable contract owns one radius.

Collision diagnostics are separate high-contrast orange wireframe projections built
directly from each document collision union. They have no collision or rigidbody
component; tapping one resolves its owning document object rather than selecting
the diagnostic entity. The toolbar describes them as physics collision shapes
and makes clear that showing or hiding them does not edit course data. The
diagnostic material is emissive and depth-independent so authored physics
outlines remain legible over the course visuals. Diagnostics default hidden so
the author opts into the intentionally strong overlay. Diagnostic entities are
created only while visible and destroyed when hidden rather than consuming
scene resources for an inactive tool. Teardown removes each diagnostic root
from the selection map before destroying it so repeated toggles retain no stale
graph nodes.

The editor camera uses right-drag orbit, Shift-drag pan, and wheel zoom on
desktop. Touch uses one-pointer orbit and two-pointer pan/pinch zoom. Inspector
nudge controls remain the precision and accessibility fallback for direct gizmo
manipulation. Pointer cursors switch to grabbing during orbit and move during
pan, then restore the default selection cursor when the camera gesture ends. A
compact help action documents one-finger orbit, two-finger pan, pinch zoom, and
their mouse equivalents without consuming persistent toolbar width. Two-touch
gestures consume both participating pointers, and cancellation never falls
through to picking.

Object multi-selection keeps stable document IDs in React state and attaches
their disposable projection entities to the maintained `TranslateGizmo` as one
node array. PlayCanvas positions that gizmo at the nodes' world-space centroid
and applies one translation delta to every node. Transform completion reads all
selected runtime positions once, validates one updated portable document, and
creates one history command. The same document helper applies Inspector group
nudges in a single validation pass. Start and checkpoint selection always
replace the group; rotate, scale, rename, and delete stay single-selection only.

## Verification

1. Every seed object produces the expected entity name, transform, material,
   collision shape, semantic tag, group, and mask.
2. Visual-only objects produce no physics components.
3. Collision-test fixtures cannot appear in production or ordinary routes.
4. Document start data drives kart initialization and reset without changing
   accepted behavior.
5. Existing selection maps still resolve the retained editable objects.
6. Existing collision, camera, kart-physics, teardown, production-build, and
   supported-browser checks pass.
7. Runtime diagnostics confirm ambient values, directional-light count,
   rotations, intensities, and shadow-preset mapping from the seed document.

## Known Limits

- Box and cylinder are the only approved version-one primitives.
- The runtime continues to use the existing model-component primitives during
  PR 2.3.1; adopting render components is a separate migration.
- Checkpoint authoring visuals remain editor-only until race progression owns
  runtime trigger lifecycle.
