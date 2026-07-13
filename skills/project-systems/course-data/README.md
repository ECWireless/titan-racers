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
[`identity-course-persistence`](../identity-course-persistence/README.md). This
node still does not own active race progression, visible checkpoint triggers,
editor commands, persistence UI, or the future add-object palette.

## Source Ownership

- `src/game/course/course-document.ts` defines the strict Zod version-one
  schema, cross-document ID and checkpoint-order refinements, canonical sorting,
  parsing, serialization, inferred TypeScript types, and validated seed export.
- `src/game/course/course-ids.ts` keeps permanent sandbox, future official, and
  current guest-runtime course selection explicit; `course-publication.ts`
  validates protected publication and privacy-minimized public runtime shapes.
- `src/game/course/rough-course.v1.json` is the canonical portable rough-course
  sandbox seed. It contains the start, six inactive ordered checkpoints,
  ordinary surfaces and objects, camera fixtures, and opt-in collision fixtures.
  It permanently restores only course ID `rough-course`; the official future
  Agricultural Zone document uses the distinct ID `agricultural-zone`.
- `src/game/course/build-rough-course.ts` projects a validated document into
  PlayCanvas visual, collision, rigid-body, tag, group, and mask state. It
  returns stable-ID entity maps plus the retained transitional lookups consumed
  by the Lite Editor and test adapter.
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
  collision, camera, editor, and supported-viewport behavior.

## Document Contract

Version one is strict JSON using metres, Y-up positions, and Euler degrees. It
contains:

- literal schema version `1`;
- a stable course ID and name;
- one stable start ID and transform;
- one ambient-light record and one-to-two stable directional-light records;
- one-to-256 checkpoints whose explicit order must match a contiguous array
  order starting at one; and
- one-to-5,000 course objects.

Every addressable start, checkpoint, object, and directional-light ID is unique
across the complete document. IDs use lowercase kebab-case and are independent
of PlayCanvas entities.

Version-one visual primitives are box and cylinder. Each object owns category,
availability, editor eligibility, transform, visual primitive, positive scale,
and semantic material. Optional collision data independently owns a box or
cylinder shape, local transform, physical dimensions, semantic role, friction,
and restitution.

Coordinates and dimensions are finite and bounded to the accepted authoring
envelope. Unknown fields and unsupported enum values fail rather than being
silently stripped. The complete document validates before scene construction.

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
- Checkpoint data exists for later race progression but creates no active
  triggers in PR 3A.
- The source seed serializes canonically with lexically sorted object keys,
  retained array order, two-space indentation, and one trailing newline.
- Parsing and serializing the canonical seed reproduces it byte-for-byte.
- The accepted course appearance, kart physics, collision, camera, reset, and
  Lite Editor behavior remain unchanged.
- Lighting is bounded to ambient plus two directional lights and four shadow
  presets; raw renderer tuning is not portable course data.

## Verification

- `tests/course-document.spec.ts`: fourteen focused document, validation,
  start-transform, and retained-geometry cases.
- `tests/course-lighting.spec.ts`: four ambient-intensity, shadow-preset,
  rollback, and atomic-attachment cases.
- `tests/course-builder.spec.ts`: five projection, exact branch, fixture-gating,
  atomic rollback, and atomic attachment cases.
- `tests/home.spec.ts`: course entity count, ground collider mapping, semantic
  drivable role, obstacle/ramp registration, complete collision and camera
  scenarios, start editing, and retained Lite Editor manipulation.
- Desktop Playwright: 84 passed and one intentional mobile-only skip.
- Mobile Playwright: 78 passed and seven intentional desktop-editor skips.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.

## Known Limits And Deferred Work

- The transitional Lite Editor still knows the two barrel IDs explicitly. PR 3C
  replaces it with document-driven selection and placement.
- Box and cylinder are the only approved primitives. Ramp and later palette
  entries are presets over those primitives rather than new shape kinds.
- The six checkpoint placements are inactive authoring data until PR 4 validates
  progression and recovery behavior.
- Postgres revisions, Better Auth, application roles, and protected course APIs
  are implemented by the candidate identity-and-course-persistence system.
- Add-object presets, full selection, collision visualization, undo/redo,
  reset-to-loaded-revision, save/reload, and export UI belong to PR 3C.
- Basic ambient and directional-light controls belong to PR 3C. Arbitrary
  placeable lights, skyboxes, fog, and post-processing remain deferred.
