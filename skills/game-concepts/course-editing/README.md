# Course Editing

**Maturity:** Validated (Phase 2).

## Purpose And Scope

This node defines the Titan Racers standard for portable course data and safe
course authoring. Read it before changing the course document, start or
checkpoint placement, primitive catalog, editor history, import/export,
collision visualization, course lighting, or reset semantics.

It does not prescribe an engine API, database, authentication provider, or UI
component. Engine mapping lives in
[`tools/playcanvas-ammo/course-editing`](../../tools/playcanvas-ammo/course-editing/README.md);
the shipped systems are
[`course-data`](../../project-systems/course-data/README.md) and
[`course-editor`](../../project-systems/course-editor/README.md).

## Standard

Treat a versioned course document as the single authored truth. Runtime
entities, physics bodies, editor selection, collision visualization, exports,
and later database revisions are projections of that document. Never persist
engine objects or make a second editable copy of course geometry.

## Desired Outcome

- A course can be loaded, validated, constructed, edited, exported, and loaded
  again without losing meaning.
- Stable authored IDs survive selection, reordering, save/load, and database
  revision changes.
- Ordinary play and physics consume the same validated data that the editor
  displays.
- Authors choose from a bounded catalog of safe course primitives and presets
  rather than creating arbitrary engine state.
- Invalid or future documents fail before partial scene construction and report
  actionable paths.
- Undo, redo, save, reload, and reset have distinct predictable meanings.

## Document Model

Every document declares a literal schema version, stable course ID, human name,
and unit convention (metres, Y-up, Euler degrees).

The document owns:

- one start transform;
- an explicitly ordered checkpoint sequence with stable IDs and trigger
  dimensions; and
- course objects with stable IDs, transforms, editor eligibility, availability,
  visual primitives, semantic materials, and optional collision definitions;
  and
- one bounded environment-lighting setup with ambient light and no more than
  two directional lights.

Persist plain JSON values only. Do not persist engine GUIDs, entity references,
material instances, physics handles, callbacks, maps, sets, or derived screen
coordinates.

## Stable Identity And Ordering

IDs are unique across every addressable object and directional light in one
course document. They are opaque authored identifiers rather than array indexes
or labels. Deleting an object does not permit silent ID reuse inside the active
editing session. Keep a session-level issued-ID set across delete, undo, redo,
and branch replacement; a newly allocated object or checkpoint must skip every
ID issued since the revision was loaded.

Checkpoint order is explicit, unique, and contiguous. Array position may be
used for presentation, but race progression must consume validated checkpoint
order rather than trusting incidental JSON ordering.

Established map formats similarly pair a format version with persistent object
and layer IDs instead of using display order as identity:
<https://doc.mapeditor.org/en/stable/reference/json-map-format/>.

## Primitive Catalog

Keep the catalog to the smallest set already proven in play (currently box and
cylinder).

Visual geometry and collision geometry are deliberately separate fields. A
visual primitive owns its display scale and semantic material. An optional
collision union owns shape-specific physical dimensions, local offset, local
rotation, and one semantic role: drivable surface or solid obstacle.

Editor placement uses approved presets such as block, barrier, barrel,
ramp, and platform. Presets create ordinary document objects with safe defaults;
they are not additional persisted engine shape types. A ramp is a rotated box.
New primitive kinds require focused runtime, collision, visualization, and
round-trip evidence before joining the catalog. Mesh authoring is outside this
standard until final track and asset workflows establish a real requirement.

## Lighting Controls

Course lighting is portable authored data rather than component-local engine
state: ambient color and intensity plus one or two directional lights with stable IDs, color, intensity, rotation, and a bounded
off/low/medium/high shadow-quality preset. Colors and intensities are bounded,
and the light count is deliberately capped to keep authoring predictable and
runtime cost reviewable.

Arbitrary point/spot light placement, skyboxes, fog, post-processing,
and renderer-specific shadow tuning remain outside this standard.

## Validation And Import

Treat every seed, import, API response, database value, and test fixture as
unknown until it crosses the same strict runtime schema.

Validation must reject:

- unsupported schema versions or unknown properties;
- missing, malformed, or duplicate IDs;
- non-finite transforms;
- non-positive visual or collision dimensions;
- unsupported primitive, material, availability, or collision-role values;
- duplicate, missing, or non-contiguous checkpoint order; and
- a missing or invalid start or checkpoint sequence.

Validation completes before scene mutation. Failure leaves the previous valid
course intact and returns field-path evidence suitable for an author-facing
error later.

JSON Schema defines the general structure and validation role of portable JSON
contracts: <https://json-schema.org/specification>.

## Serialization And Revisions

Canonical serialization uses deterministic property construction, retained
array order, two-space JSON indentation, and one trailing newline. Parsing and
serializing a valid canonical document must preserve its meaning and reproduce
the canonical text.

A source-controlled seed serves as baseline, test fixture, and recovery input.
Persistence stores complete validated documents as immutable private draft
revisions. A separately tracked published revision
identifies the validated saved document available to ordinary guest racing;
saving a draft must never silently change the live course. Runtime database
rows, draft/live status, and revision metadata must not leak into the portable
document.

## Edit History And Reset Semantics

Model each accepted edit as a command that can apply and reverse one coherent
document change. Continuous pointer manipulation may compress into one command
when the gesture completes. Pushing a new command after undo clears the redo
branch. Retain a bounded recent command window so long editing sessions do not
hold unlimited full-document snapshots; truncating the clean boundary leaves
the session dirty.

Track a clean index representing the loaded or last-saved document. Dirty state
means the current history index differs from that clean index. This follows the
well-established command-stack and clean-state model described by Qt's undo
framework: <https://doc.qt.io/qt-6/qundostack.html>.

- **Undo/redo** traverses accepted authoring commands.
- **Revert changes** restores the loaded or last-saved draft and clears
  transient manipulation after explicit confirmation when dirty.
- **Load latest draft** replaces the document with the latest authorized saved
  draft. Keep this contextual to conflict recovery rather than presenting
  loading as the ordinary authoring workflow.
- **Save draft** validates and stores a new private immutable revision without
  changing the live guest course.
- **Publish** promotes one saved draft revision to the live guest course through
  a separate authorized operation. Dirty work must be saved before it can be
  published. Publication is an append-only attributed event, not a mutation of
  the saved document or draft head.
- **Download backup** serializes the current validated document, including
  unsaved work, as an advanced recovery/interchange action rather than the
  editor's primary persistence model.
- **Leave protection** confirms editor Exit and Sign Out while dirty and uses
  the platform before-unload warning for refresh, close, or external browser
  navigation. A pending save or latest-draft load temporarily locks mutation so
  accepted commands cannot cross an asynchronous persistence boundary.
- **Recovery baseline** restores the source-controlled seed only through a
  separately labelled destructive action.

Publishing one course does not choose which course the game launches. Runtime
selection uses one explicit configured course ID, then loads only that course's
latest publication, so separate courses never merge histories.

## Protected Editor Experience

- The editor stays downstream of server authorization. An unauthorized visitor
  sees a login or access-status screen (with sign-out to switch accounts),
  never an editable workspace based on client state. Load and validate the
  protected revision before creating the authoring session.
- Use a familiar but bounded layout: compact transform/history toolbar, course
  outline, primary viewport, contextual inspector. Icon-only controls carry
  accessible names and hover/focus tooltips. Readability-heavy diagnostics
  default off.
- On narrow screens the viewport stays primary; outline and inspector become
  dismissible panels and nothing depends on hover. Touch users can finish
  ordinary placement through inspector controls rather than small 3D handles,
  and multi-touch camera gestures never fall through to selection. In-product
  camera help names both touch and pointer controls.
- Snapping is visible and reversible. Direct handles and inspector controls
  apply the same per-shape constraints.
- Multi-selection is an explicit object-only state. Group translation preserves
  relative spacing as one command; other group operations stay
  single-selection until designed.
- Palette presets spawn ordinary bounded objects near the start. Every
  accepted nudge or completed gesture is one history command. Stable IDs
  never change when an optional human label does; the start cannot be deleted
  and at least one checkpoint remains.

## Validation Evidence

1. Valid seed data parses and canonicalizes deterministically.
2. Invalid versions, unknown fields, duplicate IDs, invalid dimensions, and bad
   checkpoint order fail with exact paths.
3. Every seed visual and collider is constructed from the
   validated document with unchanged transforms and semantic behavior.
4. Opt-in collision fixtures remain excluded from ordinary play.
5. Start/reset, editor manipulation, collision, camera, and driving regressions
   remain green.
6. Exported canonical JSON parses back into an equivalent document.

## Known Limits

- Final track meshes and art authoring are not part of this standard; new
  primitive kinds need runtime, collision, and round-trip evidence first.
- Arbitrary placeable lights and advanced rendering effects are deferred.
