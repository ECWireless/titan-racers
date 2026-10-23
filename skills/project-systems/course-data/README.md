# Course Data System

**Maturity:** Validated (PR 2.3.1, extended by PR 2.4.2).

## Purpose And Scope

This node documents the implemented Titan Racers course-data foundation. It
combines the engine-independent
[`course-editing`](../../game-concepts/course-editing/README.md) standard with
the PlayCanvas mapping in
[`tools/playcanvas-ammo/course-editing`](../../tools/playcanvas-ammo/course-editing/README.md).

The system owns the portable course-document contract, strict runtime
validation, canonical serialization, source-controlled rough-course seed,
stable authored IDs, start/checkpoint records, bounded primitive definitions,
semantic collision roles, placement in the habitat enclosure, diagnostic
availability, and construction of static PlayCanvas course entities.

Database revisions, authentication, and authorization are now owned by
[`identity-course-persistence`](../identity-course-persistence/README.md).
Active race progression and checkpoint recovery are owned by
[`race-progression`](../race-progression/README.md). This node still does not
own editor commands or persistence UI.

## Source Ownership

- `src/game/course/course-document.ts` defines strict Zod legacy schemas and the
  canonical version-four schema, deterministic legacy normalization,
  cross-document ID and checkpoint-order refinements, gate-face direction
  alignment, canonical sorting, serialization, inferred TypeScript types, and
  validated seed export.
- `src/game/course/course-ids.ts` keeps the permanent sandbox, the official
  courses with bundled seeds, and the guest solo course (`agricultural-zone`)
  explicit; `course-publication.ts`
  validates protected publication and privacy-minimized public runtime shapes.
- `src/game/course/rough-course.v4.json` is the canonical portable rough-course
  sandbox seed. It contains the start/finish gate, three ordered checkpoints
  whose gates reach from the infield into the grass, with directed gate and
  recovery data, an infield barrier, ordinary surfaces and objects, camera
  fixtures, and opt-in collision fixtures.
  It permanently restores only course ID `rough-course`; the official
  Agricultural Zone document uses the distinct ID `agricultural-zone`, seeded
  by `agricultural-zone.v4.json` (a small starter loop in another valley).
  `BUNDLED_COURSE_DOCUMENTS` maps each official course to its seed.
- `src/game/course/build-rough-course.ts` projects a validated document into
  PlayCanvas visual, collision, rigid-body, tag, group, and mask state. It
  returns stable-ID entity maps plus two explicit sandbox obstacle lookups used
  by reset-clearance checks and the non-production scene test adapter.
- `src/game/course/course-visual-policy.ts` owns the depth-bias tiers that
  order coplanar surface layers, maps material keys to them, and decides which
  thin layers draw only their top face.
- `src/game/course/course-surface-materials.ts` creates the course finishes
  shared by the race and editor (see
  [scene lighting](../scene-lighting/README.md)) and the top-face meshes.
- `src/game/course/build-course-lighting.ts` projects the enclosure's sun
  into one shadow-casting directional light.
- `src/game/enclosure/island-three.ts` owns the approved enclosure registry,
  placement limits, and the enclosure frame and sun direction in course
  coordinates ([Island Three](../../../docs/island-three.md)).
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

Canonical version four is strict JSON using metres, Y-up positions, and Euler
degrees. It contains:

- literal schema version `4`;
- a stable course ID and name;
- one stable start ID, transform (the start/finish gate), bounded start-gate
  half-extents, and a spawn distance (0–10 m) placing the kart behind the gate
  along its heading; legacy courses normalize to 0 and the editor marks the
  spawn;
- one enclosure reference (`id`, `version`) with its placement (`axial`,
  `azimuth`, `heading`, `height`) and the mirror angle that sets the time of
  day, validated against the enclosure registry;
- one-to-256 checkpoints whose explicit order must match a contiguous array
  order starting at one, each with bounded oriented half-extents, a normalized
  gate-face direction, and a recovery transform; and
- one-to-5,000 course objects.

Every addressable start, checkpoint, and object ID is unique
across the complete document. IDs use lowercase kebab-case and are independent
of PlayCanvas entities.

Visual primitives are box and cylinder. Each object owns category,
availability, editor eligibility, transform, visual primitive, positive scale,
and semantic material. Optional collision data independently owns a box or
cylinder shape, local transform, physical dimensions, semantic role, friction,
restitution, and a versioned `surfaceMaterial` reference. Visual material never
selects tire grip.

Coordinates and dimensions are finite and bounded to the accepted authoring
envelope. Unknown fields and unsupported enum values fail rather than being
silently stripped. The complete document validates before scene construction.

## Legacy Normalization

Stored revisions are immutable, so `parseCourseDocument` keeps strict
version-one to version-three schemas and normalizes them in memory to version
four; canonical serialization and every new save use version four. Version
two adds
`start.gateHalfExtents`, `checkpoints[].forward`, and
`checkpoints[].recovery`.

- **Gate direction:** the route tangent between a checkpoint's preceding and
  next anchors picks and signs the best-aligned rotated box axis (a
  single-checkpoint course uses start-to-checkpoint). Candidate version-two
  forward hints are also snapped to their gate face in memory, keeping already
  published diagonal values playable without rewriting stored rows.
- **Recovery:** position from the lower face of the checkpoint volume; yaw
  toward the next anchor, wrapping the final checkpoint toward the start.
- **Start gate:** reviewed default half-extents.
- **Enclosure (version three and earlier):** placed at the middle of Island
  Three's first valley, turned and timed on the evening side so the sun
  shines from the old key light's direction; it reaches the course when that
  light was above about 27°. Ambient and other lights are dropped.
- Degenerate coincident anchors or directions that cannot identify a face are
  rejected rather than invented.
- A loaded version-one row is normalized in memory, and its next save creates a
  new version-four revision. Persistence responses report the normalized schema
  version consistently.

Every legacy collider normalizes to `surface.standard-course@1`, including
visually green surfaces. The rough-course seed layers lawn grass on the base ground, 2 m
short-turf verges (edge strips and cap discs) under the asphalt edge, short-turf
infield cutouts, and an infield lawn leaving 1.5 m turf bands. Coplanar visual
layers follow the material order in `course-visual-policy.ts`, while physics
follows document order, so authored surfaces must list in that same layer order
and pair each grass finish with its matching surface material. Collider surface
identity survives editor transforms, history, save/load, and export; presets use
standard-course identity and there is no surface inspector control. Per-wheel
resolution and coplanar-layer precedence are owned by
[environment contact interaction](../../../docs/kart-system/environment.md).

In the editor, moving a checkpoint translates its recovery pose, rotating it
rotates the gate direction, and scaling changes only face bounds; new
checkpoints derive defaults from their neighbors and start movement carries the
start gate. Start-gate sizing and separate direction/recovery controls are not
exposed in the UI.

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
9. The enclosure's sun maps to one directional entity, with renderer-specific
   shadow details kept in the adapter.

## Accepted Invariants

- The validated document is the only authored course truth.
- Runtime and test entities are projections; the builder never mutates the
  document.
- Visual scale does not silently define collision dimensions.
- A drivable surface draws its top exactly at its collision top, and a
  visual-only marking rests on the highest surface beneath it. Layers at the
  same height are ordered by depth bias (base ground, turf verge, asphalt,
  infield turf, lawn, paint), never by separating their heights. Thin, level layers draw only
  their top face, so the slope-scaled bias cannot pull hidden side faces
  through as seams.
- Objects without collision data receive no collision or rigid-body component.
- Diagnostic collision fixtures cannot appear in production or ordinary play.
- Checkpoint data is projected into plain directed swept gates by the separate
  race-progression system; it does not create collision-trigger entities.
- The source seed serializes canonically with lexically sorted object keys,
  retained array order, two-space indentation, and one trailing newline.
- Parsing and serializing the canonical seed reproduces it byte-for-byte.
- The accepted course appearance, kart physics, collision, camera, and reset
  behavior remain unchanged while authoring lives only in the protected editor.
- Course light comes from the enclosure: the document chooses only the mirror
  angle, and raw renderer tuning is not portable course data.

## Verification

- `tests/course-document.spec.ts`: schema, seed, stable IDs, checkpoint order,
  canonical round-trip, version normalization, invalid input, and retained
  geometry.
- `tests/course-lighting.spec.ts`, `tests/island-three-enclosure.spec.ts`, and
  `tests/course-builder.spec.ts`: sunlight and enclosure geometry, projection,
  fixture gating, and atomic rollback.
- `tests/home.spec.ts`: runtime construction and semantic collision roles.

## Known Limits

- The runtime test adapter keeps two explicit barrel IDs for collision-transform
  fixtures.
- Box and cylinder are the only approved primitives; ramps and other palette
  entries are presets over them. New primitive kinds need runtime, collision,
  and round-trip evidence.
- Arbitrary placeable lights, skyboxes, fog, and post-processing are deferred.
