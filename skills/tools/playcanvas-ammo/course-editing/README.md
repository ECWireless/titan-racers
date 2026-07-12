# PlayCanvas Course Editing

**Maturity:** Candidate. The feature lead accepted this PlayCanvas 2.20.6
mapping for PR 3A on 2026-07-11. Promote it to validated only after the course
runtime migration and browser regression gates pass.

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
Checkpoint volumes are document data in PR 3A and do not become triggers until
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

PR 3C should visualize the document's authoritative collision union rather than
querying or copying Ammo shapes. Boxes can be rendered from half-extents and
local offsets; cylinders from radius, height, axis, and offsets. Use dedicated
debug materials or PlayCanvas immediate lines without physics participation.

PlayCanvas `Application.drawLine` and related immediate-line methods accept
world-space points and optional depth testing:
<https://api.playcanvas.com/engine/classes/Application.html#drawLine>.

The visualization must update from the same in-memory document command that
updates runtime collision geometry and must never become a selectable physical
object itself.

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
  PR 3A; adopting render components is a separate migration.
- PR 3A does not create checkpoint triggers or collision debug visuals.
- The implemented project-system node must wait for accepted runtime evidence.
