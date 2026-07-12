# Course Editing

**Maturity:** Candidate. The feature lead accepted this engine-independent
standard for PR 3A on 2026-07-11. Promote it to validated only after the course
document, runtime migration, deterministic serialization, and regression gates
pass and the resulting authoring contract is accepted.

## Purpose And Scope

This node defines the Titan Racers standard for portable course data and safe
course authoring. Read it before changing the course document, start or
checkpoint placement, primitive catalog, editor history, import/export,
collision visualization, course lighting, or reset semantics.

It does not prescribe an engine API, database, authentication provider, or UI
component. Tool-specific mapping belongs under
[`../../tools/`](../../tools/README.md). Actual shipped ownership belongs under
[`../../project-systems/`](../../project-systems/README.md) only after the
implementation has been validated.

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
and unit convention. Version one uses metres, Y-up coordinates, and Euler
rotation values in degrees for authored interchange.

The document owns:

- one start transform;
- an explicitly ordered checkpoint sequence with stable IDs and trigger
  dimensions; and
- course objects with stable IDs, transforms, editor eligibility, availability,
  visual primitives, semantic materials, and optional collision definitions.
- one bounded environment-lighting setup with ambient light and no more than
  two directional lights.

Persist plain JSON values only. Do not persist engine GUIDs, entity references,
material instances, physics handles, callbacks, maps, sets, or derived screen
coordinates.

## Stable Identity And Ordering

IDs are unique across every addressable object and directional light in one
course document. They are opaque authored identifiers rather than array indexes
or labels. Deleting an object does not permit silent ID reuse inside the active
editing session.

Checkpoint order is explicit, unique, and contiguous. Array position may be
used for presentation, but race progression must consume validated checkpoint
order rather than trusting incidental JSON ordering.

Established map formats similarly pair a format version with persistent object
and layer IDs instead of using display order as identity:
<https://doc.mapeditor.org/en/stable/reference/json-map-format/>.

## Primitive Catalog

Version one supports the smallest catalog already proven by the rough course:

- box; and
- cylinder.

Visual geometry and collision geometry are deliberately separate fields. A
visual primitive owns its display scale and semantic material. An optional
collision union owns shape-specific physical dimensions, local offset, local
rotation, and one semantic role: drivable surface or solid obstacle.

Editor placement later uses approved presets such as block, barrier, barrel,
ramp, and platform. Presets create ordinary document objects with safe defaults;
they are not additional persisted engine shape types. A ramp is a rotated box.
New primitive kinds require focused runtime, collision, visualization, and
round-trip evidence before joining the catalog. Mesh authoring is outside this
standard until final track and asset workflows establish a real requirement.

## Lighting Controls

Course lighting is portable authored data rather than component-local engine
state. Version one supports ambient color and intensity plus one or two
directional lights with stable IDs, color, intensity, rotation, and a bounded
off/low/medium/high shadow-quality preset. Colors and intensities are bounded,
and the light count is deliberately capped to keep authoring predictable and
runtime cost reviewable.

PR 3C exposes these values as basic environment controls with reset-to-loaded
behavior. Arbitrary point/spot light placement, skyboxes, fog, post-processing,
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

A source-controlled seed is the rough-course baseline, test fixture, and
recovery input. Later persistence stores complete validated documents as
immutable revisions. Runtime database rows and revision metadata must not leak
into the portable document.

## Edit History And Reset Semantics

Model each accepted edit as a command that can apply and reverse one coherent
document change. Continuous pointer manipulation may compress into one command
when the gesture completes. Pushing a new command after undo clears the redo
branch.

Track a clean index representing the loaded or last-saved document. Dirty state
means the current history index differs from that clean index. This follows the
well-established command-stack and clean-state model described by Qt's undo
framework: <https://doc.qt.io/qt-6/qundostack.html>.

- **Undo/redo** traverses accepted authoring commands.
- **Reset** restores the loaded revision and clears transient manipulation.
- **Reload** replaces the document with the latest authorized persisted
  revision after explicit confirmation when dirty.
- **Recovery baseline** restores the source-controlled seed only through a
  separately labelled destructive action.

PR 3A implements the document and deterministic serialization, not the command
stack UI. PR 3C implements the history and visible reset/reload behavior.

## Validation Evidence

1. Valid seed data parses and canonicalizes deterministically.
2. Invalid versions, unknown fields, duplicate IDs, invalid dimensions, and bad
   checkpoint order fail with exact paths.
3. Every retained rough-course visual and collider is constructed from the
   validated document with unchanged transforms and semantic behavior.
4. Opt-in collision fixtures remain excluded from ordinary play.
5. Start/reset, editor manipulation, collision, camera, and driving regressions
   remain green.
6. Exported canonical JSON parses back into an equivalent document.

## Known Limits

- Version one supports only box and cylinder primitives.
- Checkpoints are authored but remain behaviorally inactive until the rough
  race-loop work.
- Database revisions and protected APIs belong to PR 3B.
- Placement palette, collision visualization, undo/redo, and save/reload UI
  belong to PR 3C.
- Basic environment-light controls belong to PR 3C; arbitrary placeable lights
  and advanced rendering effects remain deferred.
- Final Agricultural Zone meshes and art authoring remain later-phase work.
