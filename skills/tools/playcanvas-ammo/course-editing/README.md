# PlayCanvas Course Editing

**Maturity:** Validated (PRs 2.3.1–2.3.3, July 2026).

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

Visual primitives map as follows:

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

### Arcs

A document `arc` (see [curved course
geometry](../../../game-concepts/curved-course-geometry/README.md)) is built to
size at scale 1, about its entity origin:

- **Visual:** one generated `pc.Mesh` on a `render` component. It must carry
  the box primitive's vertex streams (position, normal, UV0, UV1, all float32;
  `scene/geometry/box-geometry.js`) and cast shadows like boxes, because the
  static batcher splits batches on material, layer, vertex-format
  `batchingHash`, indexing, `_shaderDefs` (which include UV presence), and
  `castShadow` (`scene/batching/batch-manager.js`). Matching them lets arcs
  merge into their finish's existing batch: no extra draw calls, no new shader
  program. The course finishes sample world position, so UVs are placeholders.
  A mesh instance frees its mesh when the instance is destroyed, so generated
  meshes need no separate ownership.
- **Collision:** one static box rigidbody per generated piece, on child
  entities tagged like the arc's role. Separate static bodies match how
  authored boxes already behave (contacts, the chase camera's ray, the static
  broadphase) and avoid compound-shape construction order.
- **Not used:** triangle meshes (the vendored Ammo build has no
  `btGenerateInternalEdgeInfo`/`btTriangleInfoMap`, so internal edges cannot be
  corrected) and convex hulls (PlayCanvas forces a 1 cm hull margin,
  `framework/components/collision/system.js`).

## Lighting Mapping

Map the enclosure's sun to one PlayCanvas directional light entity. A
directional light shines down its local −Y, and PlayCanvas applies Euler X
before Y, so the Euler angles (acos(s.y), atan2(s.x, s.z), 0) turn it onto the
rays from a unit sun direction s. Keep color, intensity, bias, distance, and
shadow resolution inside the adapter rather than exposing raw renderer tuning
in the portable course contract.

## Semantic Physics Roles

Map `drivable-surface` to the existing drivable tag, physics group/mask,
friction, and zero-restitution static-body policy. Map `solid-obstacle` to the
existing obstacle tag, solid group/mask, friction, and zero-restitution static
policy.

Objects without collision data receive no collision or rigid-body component.
Checkpoints never become collision or trigger entities; race progression
projects them into plain directed gates (see
[`race-progression`](../race-progression/README.md)).

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

Diagnostics visualize the document's authoritative collision union rather than
querying or copying Ammo shapes. Boxes can be rendered from half-extents and
local offsets; cylinders from radius, height, axis, and offsets; arcs from the
same generated pieces the runtime builds. Use dedicated
debug materials or PlayCanvas immediate lines without physics participation.

PlayCanvas `Application.drawLine` and related immediate-line methods accept
world-space points and optional depth testing:
<https://api.playcanvas.com/engine/classes/Application.html#drawLine>.

The visualization must update from the same in-memory document command that
updates runtime collision geometry and must never become a selectable physical
object itself.

## Open-Source Editor Reference

The MIT-licensed PlayCanvas Editor frontend informed the authoring design, but
Titan Racers uses the pinned Engine APIs directly rather than its
architecture: `TranslateGizmo`, `RotateGizmo`, and `ScaleGizmo` for one command
per completed gesture, `Picker` for selection (paused while a gizmo owns the
pointer), and explicit toolbar actions with keyboard equivalents for mode,
snapping, focus, and history. Its Observer, PCUI, collaboration, and asset
systems are deliberately not used. The draft/publish split mirrors PlayCanvas's
editable-project vs published-build boundary: Save Draft creates a private
revision, Publish promotes one saved revision to guest play, and Download
Backup is only portable recovery.

The guest runtime validates the published response and passes it through the
same `buildRoughCourse` and `buildCourseLighting` projections; it never reads a
draft and has no editor mode.

- <https://github.com/playcanvas/editor>
- <https://developer.playcanvas.com/user-manual/editor/>

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

`Picker` resolves a generated mesh's instances like any primitive's. A
wireframe drawn from a generated mesh must pass `renderStyle` in the render
component's data: assigning `meshInstances` resets each instance's style to
the component's.

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
7. Runtime diagnostics confirm the directional-light count and the sun's
   direction, intensity, and shadow mapping from the seed document.

## Known Limits

- Box, cylinder, and arc are the approved primitives; arcs are walls only.
- Box and cylinder visuals use PlayCanvas `model` components; adopting
  `render` components for them would be a separate migration. Arcs, top-face
  layers, and a course lamp's arm and luminaire use `render`.
