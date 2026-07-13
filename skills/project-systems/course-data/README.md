# Course Data System

## Status

**Maturity:** Candidate. PR 3A implementation and automated desktop/mobile,
static, production-build, physics, collision, camera, and editor regression
gates pass as of 2026-07-12. Promote this node to validated after the required
independent reviews and feature-lead acceptance.

## Purpose And Scope

This node documents the implemented Titan Racers course-data foundation. It
combines the engine-independent
[`course-editing`](../../game-concepts/course-editing/README.md) standard with
the PlayCanvas mapping in
[`tools/playcanvas-ammo/course-editing`](../../tools/playcanvas-ammo/course-editing/README.md).

The system owns the portable course-document contract, strict runtime
validation, canonical serialization, source-controlled rough-course seed,
stable authored IDs, start/checkpoint records, bounded primitive definitions,
semantic collision roles, bounded environment lighting, diagnostic
availability, and construction of static PlayCanvas course entities.

Database revisions, authentication, and authorization are now owned by
[`identity-course-persistence`](../identity-course-persistence/README.md).
Active race progression and checkpoint recovery are owned by
[`race-progression`](../race-progression/README.md). This node still does not
own editor commands, persistence UI, or the future add-object palette.

## Source Ownership

- `src/game/course/course-document.ts` defines strict Zod version-one and
  canonical version-two schemas, deterministic v1-to-v2 normalization,
  cross-document ID and checkpoint-order refinements, gate-face direction
  alignment, canonical sorting, serialization, inferred TypeScript types, and
  validated seed export.
- `src/game/course/course-ids.ts` keeps permanent sandbox, future official, and
  current guest-runtime course selection explicit; `course-publication.ts`
  validates protected publication and privacy-minimized public runtime shapes.
- `src/game/course/rough-course.v2.json` is the canonical portable rough-course
  sandbox seed. It contains the start/finish gate, six ordered checkpoints with
  directed gate and recovery data, ordinary surfaces and objects, camera
  fixtures, and opt-in collision fixtures.
  It permanently restores only course ID `rough-course`; the official future
  Agricultural Zone document uses the distinct ID `agricultural-zone`.
- `src/game/course/build-rough-course.ts` projects a validated document into
  PlayCanvas visual, collision, rigid-body, tag, group, and mask state. It
  returns stable-ID entity maps plus two explicit sandbox obstacle lookups used
  by reset-clearance checks and the non-production scene test adapter.
- `src/game/course/build-course-lighting.ts` projects bounded ambient and
  directional-light records into PlayCanvas scene state and fixed shadow
  presets.
- `src/components/solo-time-trial-canvas.tsx` reads the validated start transform,
  accepts a validated course document, passes repository-owned material
  instances to the builder, and projects the same published document through
  course geometry, start, collision, and lighting construction.
- `tests/course-document.spec.ts` owns schema, seed, catalog, stable-ID,
  checkpoint-order, canonical round-trip, invalid-input, and retained-geometry
  assertions.
- `tests/home.spec.ts` verifies runtime construction and all retained gameplay,
  collision, camera, pause, test-adapter, and supported-viewport behavior.

## Document Contract

Canonical version two is strict JSON using metres, Y-up positions, and Euler
degrees. It contains:

- literal schema version `2`;
- a stable course ID and name;
- one stable start ID, transform, and bounded start-gate half-extents;
- one ambient-light record and one-to-two stable directional-light records;
- one-to-256 checkpoints whose explicit order must match a contiguous array
  order starting at one, each with bounded oriented half-extents, a normalized
  gate-face direction, and a recovery transform; and
- one-to-5,000 course objects.

Every addressable start, checkpoint, object, and directional-light ID is unique
across the complete document. IDs use lowercase kebab-case and are independent
of PlayCanvas entities.

Visual primitives are box and cylinder. Each object owns category,
availability, editor eligibility, transform, visual primitive, positive scale,
and semantic material. Optional collision data independently owns a box or
cylinder shape, local transform, physical dimensions, semantic role, friction,
and restitution.

Coordinates and dimensions are finite and bounded to the accepted authoring
envelope. Unknown fields and unsupported enum values fail rather than being
silently stripped. The complete document validates before scene construction.
Immutable stored version-one revisions remain readable through deterministic
in-memory normalization; canonical serialization and new saves use version two.

## Construction Flow

1. The JSON module is parsed through the canonical Zod schema at module load.
2. The canvas receives only the validated `CourseDocument` value.
3. The builder visits objects in document order and excludes `collision-test`
   objects unless the existing non-production hook and deliberate query opt-in
   enable them.
4. Semantic material keys resolve to repository-owned PlayCanvas materials.
5. Visual and collision primitives are created from their independent authored
   dimensions.
6. Collision roles resolve to the established tags, physics groups, and masks.
7. Stable document IDs become entity names and keys in the returned runtime
   map; engine GUIDs never enter document state.
8. The existing application lifecycle destroys every constructed entity and
   physics component.
9. Course-level lighting maps to ambient scene color and stable directional
   entities, with renderer-specific shadow details kept in the adapter.

## Accepted Invariants

- The validated document is the only authored course truth.
- Runtime and test entities are projections; the builder never mutates the
  document.
- Visual scale does not silently define collision dimensions.
- Objects without collision data receive no collision or rigid-body component.
- Diagnostic collision fixtures cannot appear in production or ordinary play.
- Checkpoint data is projected into plain directed swept gates by the separate
  race-progression system; it does not create collision-trigger entities.
- The source seed serializes canonically with lexically sorted object keys,
  retained array order, two-space indentation, and one trailing newline.
- Parsing and serializing the canonical seed reproduces it byte-for-byte.
- The accepted course appearance, kart physics, collision, camera, and reset
  behavior remain unchanged while authoring lives only in the protected editor.
- Lighting is bounded to ambient plus two directional lights and four shadow
  presets; raw renderer tuning is not portable course data.

## Verification

- `tests/course-document.spec.ts`: eighteen focused document, validation,
  start-transform, and retained-geometry cases.
- `tests/course-lighting.spec.ts`: four ambient-intensity, shadow-preset,
  rollback, and atomic-attachment cases.
- `tests/course-builder.spec.ts`: five projection, exact branch, fixture-gating,
  atomic rollback, and atomic attachment cases.
- `tests/home.spec.ts`: course entity count, ground collider mapping, semantic
  drivable role, obstacle/ramp registration, complete collision and camera
  scenarios, and explicit non-production start/tuning/transform fixtures.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.

## Known Limits And Deferred Work

- The sandbox runtime test adapter retains two explicit barrel IDs for focused
  collision-transform fixtures; ordinary authoring uses document-driven stable
  IDs in the protected editor.
- Box and cylinder are the only approved primitives. Ramp and later palette
  entries are presets over those primitives rather than new shape kinds.
- The six checkpoint placements drive the accepted rough-loop progression and
  recovery behavior; final checkpoint and race HUD presentation remains PR 4C.
- Postgres revisions, Better Auth, application roles, and protected course APIs
  are implemented by the candidate identity-and-course-persistence system.
- Add-object presets, full selection, collision visualization, undo/redo,
  reset-to-loaded-revision, save/reload, publication, and backup download are
  implemented by the protected course editor.
- Basic ambient and directional-light controls are implemented. Arbitrary
  placeable lights, skyboxes, fog, and post-processing remain deferred.
