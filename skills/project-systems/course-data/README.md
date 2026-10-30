# Course Data System

**Maturity:** Validated (PR 2.3.1, extended by PRs 2.4.2, 4.4.2, 4.4.3, and
4.4.4).

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
  canonical version-ten schema, deterministic legacy normalization,
  cross-document ID and checkpoint-order refinements, gate-face direction
  alignment, canonical sorting, serialization, inferred TypeScript types, and
  validated seed export.
- `src/game/course/course-ids.ts` keeps the permanent sandbox, the official
  courses with bundled seeds, and the guest solo course (`falls-view-park`)
  explicit; `course-publication.ts`
  validates protected publication and privacy-minimized public runtime shapes.
- `src/game/course/rough-course.v10.json` is the canonical portable rough-course
  sandbox seed. It contains the start/finish gate, three ordered checkpoints
  whose gates reach from the infield into the grass, with directed gate and
  recovery data, an infield barrier, ordinary surfaces and objects, camera
  fixtures, and opt-in collision fixtures.
  It permanently restores only course ID `rough-course`; the official
  Falls View Park document uses the distinct ID `falls-view-park`, seeded by
  `falls-view-park.v10.json`: a walled two-lap circuit of about 550 m, with
  4.5 m lanes for four karts abreast, from a utility tunnel through nursery
  rows and a culvert, up onto a levee crest facing the falls, down the
  levee's anti-spinward access ramp or the youth's jump beside it, and
  back along a return lane, placed in another valley 2.5 km from the
  sunward end cap, at deep dusk (mirror 89.5°) under floodlights. Its start
  sits in a roofed, lamp-lit, and dressed utility tunnel under an earth berm.
  Past the tunnel the route forks: turf alleys between planted beds take the
  nursery hairpins, or the service road swoops south behind hedges and climbs
  an access ramp to the levee crest; both rejoin before the crest checkpoint.
  The nursery route leaves through the culvert, a precast box lit by the
  youth's work lights, under a perched stream and the levee; the stream
  drains west to an outfall at the perimeter wall, with room beside it for
  4.4.7's storm drain. Two of the youth's bicycles lean at the crest's
  handrail and wall. Past the crest an S-bend ramp comes down to the park,
  with the youth's jump straight across its inside (PR 4.4.5 in the plan).
  The return lane has 150 mm kerbs and edge lines, with four full-size
  street lamps along its anti-sunward run. It stands
  0.9 m above the habitat floor (`enclosure.placement.height`), so the
  floor, which curves up around the axis across its 164 m north–south span,
  stays below the chase camera at every wall. Its perimeter walls reach 1 m
  below the park's ground, to the floor of its clearing outside them, which
  follows the floor's curve: from 0.9 m below the park's ground beside its
  west and east walls to 0.4 m above it at the south wall, rising about
  5 m by the clearing's edge around the axis.
  `BUNDLED_COURSE_DOCUMENTS` maps each official course to its seed.
- `src/game/course/course-clearing.ts` builds the habitat floor of a course's
  clearing from the enclosure model: outside the course's footprint, out to
  the clearing's 220 m edge, strips across the curve at most 10 m wide (their
  chords sag at most 3.1 mm) cut into pieces at most 20 m long along the
  axis, each a 0.5 m slab whose top is the drawn ground; at the edge the
  slabs run a little past it, under ground the fence closes off.
  `addCourseClearing` (in `build-rough-course.ts`) draws the tops as one lawn
  mesh in the race's static lawn batch and adds a static body per slab, which
  supports karts as lawn grass and resolves straight to it, so the surface
  lookup never scans the clearing's slabs. The editor does not draw it.
- `src/game/course/build-rough-course.ts` projects a validated document into
  PlayCanvas visual, collision, rigid-body, tag, group, and mask state. It
  returns stable-ID entity maps plus two explicit sandbox obstacle lookups used
  by reset-clearance checks and the non-production scene test adapter.
- `src/game/course/course-arc.ts` generates an arc's smooth surface and its
  collision boxes from its dimensions, at 3 mm visual and 5 mm collision
  tolerance; the builder turns them into a render mesh and static box bodies.
- `src/game/course/course-visual-policy.ts` owns the depth-bias tiers that
  order coplanar surface layers, maps material keys to them, and decides which
  thin layers draw only their top face.
- `src/game/course/course-surface-materials.ts` creates the course finishes
  shared by the race and editor (see
  [scene lighting](../scene-lighting/README.md)) and the top-face meshes.
- `src/game/course/course-tree-geometry.ts` builds the planted beds' trees
  (where each stands, its three variants' bark, leaf sprays, and stake, and
  its one collider box round stem and stake) and the hedges' leaf sprays
  from a validated document, deterministically; `course-trees.ts` draws them
  (see [scene lighting](../scene-lighting/README.md)) and adds the static
  colliders, which carry no `obstacle` tag, so the chase camera looks past
  trees.
- `src/game/course/course-water.ts` finds a document's water boxes and their
  flow, and tells the race when a kart's centre of mass is under water, so
  it is drowned and recovered.
- `src/game/course/course-bicycle-geometry.ts` builds the two parked
  bicycles at real size in precomputed leaning poses; `course-trees.ts`
  draws them in place of their boxes and adds static colliders built from
  their geometry below 0.35 m, untagged like the trees'.
- `src/game/course/build-course-lighting.ts` projects the enclosure's sun
  into one shadow-casting directional light.
- `src/game/enclosure/island-three.ts` owns the approved enclosure registry,
  placement limits, and the enclosure frame and sun direction in course
  coordinates ([Island Three](../../../docs/island-three.md)).
- `src/components/solo-time-trial-canvas.tsx` reads the validated start transform,
  accepts a validated course document, passes repository-owned material
  instances to the builder, and projects the same published document through
  course geometry, start, collision, and lighting construction.
- `tests/course-arc.spec.ts` owns the arc generator: segment counts, chord
  error, normals and winding, and collision boxes that meet on the outer face.
- `tests/course-trees.spec.ts` owns tree placement, colliders, size,
  triangle budget, winding, and hedge spray coverage.
- `tests/course-clearing.spec.ts` owns the clearing's floor: every vertex on
  the habitat floor, slab tops within the sagitta, no ground inside the
  footprint, and support everywhere outside it.
- `tests/course-water.spec.ts` owns water volumes and drowning;
  `tests/course-bicycle-geometry.spec.ts` owns the bicycles' build, poses,
  colliders, and their contact with the crest's rail and wall.
- `tests/course-document.spec.ts` owns schema, seed, catalog, stable-ID,
  checkpoint-order, canonical round-trip, invalid-input, and retained-geometry
  assertions.
- `tests/home.spec.ts` verifies runtime construction and all retained gameplay,
  collision, camera, pause, test-adapter, and supported-viewport behavior.

## Document Contract

Canonical version ten is strict JSON using metres, Y-up positions, and Euler
degrees. It contains:

- literal schema version `10`;
- a stable course ID and name;
- one stable start ID, transform (the start/finish gate), bounded start-gate
  half-extents, and a spawn distance (0–10 m) placing the kart behind the gate
  along its heading; legacy courses normalize to 0 and the editor marks the
  spawn;
- one enclosure reference (`id`, `version`) with its placement (`axial`,
  `azimuth`, `heading`, `height`) and the mirror angle (5–90°) that sets the
  time of day, validated against the enclosure registry;
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
selects tire grip. An object marked `lamp: "floodlight"` is a floodlight's mast:
`course-lamps.ts` adds the arm, luminaire, and spot light on its top, reaching
along its local -Z. A course has at most twelve floodlights
(`COURSE_LAMP_LIMIT`). An object marked `lamp: "tunnel"` is a tunnel
luminaire's housing, with its lens and downward light beneath it, and
version eight's `lamp: "work"` is the youth's battery work light, hung
the same way. Tunnel and work lamps are indoor lamps: a course has at most
twenty (`COURSE_INDOOR_LAMP_LIMIT`; sixteen before version eight), counted
apart from the floodlights. Version six also adds `indoors: true`, for objects lit only by
indoor light (tunnel and work lamps stand indoors, floodlights and street
lamps outdoors), and
`overhead: true`, for roofs and the earthworks over them, which the editor
can cut away and which never support a kart; a kart beneath an object that
is both counts as indoors.

Version six adds arcs. An arc's visual has no scale: `visual.arc` holds its
inner radius (≥ 0.05 m), width (≥ 0.1 m), height, and sweep (up to 360°), with
an outer radius of at most 200 m and a width of at most 16 times its inner
radius (which bounds its collision boxes). It sweeps about the object's origin, at its
base, from local +X toward local −Z, so bends that share a centre share a
position. Its collision is `{ shape: "arc" }` with friction, restitution, a
surface material, and the solid-obstacle role only; arcs and only arcs collide
as arcs, and lamps never stand on them. Segment counts and collision boxes are
derived at build time, never stored. `isCoursePrimitiveObject` narrows to the
box and cylinder objects that have a scale.

Version seven adds the `timber`, `mulch`, and `hedge` finishes and planted
beds. `planting: { along, across }` (0.5–20 m) on an outdoor box that is not
a lamp or roof grows young trees on its top, in rows along its local X
`along` apart, the rows `across` apart along its local Z
(`getCoursePlantingGrid`). A `hedge` finish must also be an outdoor box that
is not a lamp or roof; its sides and top carry 24 leaf sprays a square
metre. A course holds at most 2,000 trees (`COURSE_TREE_LIMIT`) and 40,000
hedge sprays (`COURSE_HEDGE_SPRAY_LIMIT`).

Version eight adds the `concrete`, `gravel`, and `water` finishes, work
lamps, and parked bicycles. Water is an outdoor box without collision that
is not a lamp, roof, or bed: its top is the surface, its volume the water a
kart drowns in, and the bed beneath is its own colliding object, drawn in
`gravel` (the water blends over gravel's colour).
`bicycle: "hardtail" | "bmx"` (`COURSE_BICYCLES`) marks an upright outdoor
box without collision as a parked bicycle, drawn centred in it on its floor;
in a race the box is disabled, and the bicycle draws and collides as its
own shape. Each bicycle's pose leans on what the seed stands it against, so
it only rests naturally there.

Version nine adds `lamp: "street"`: an outdoor cylinder column that is not
an overhead object, with at most eight per course (`COURSE_STREET_LAMP_LIMIT`),
counted independently of floodlights and indoor lamps. Its arm, lantern, and
warm-white light are owned by [scene lighting](../scene-lighting/README.md).
Version-eight documents upgrade unchanged in memory; stored revisions stay
immutable. The schema change needs no database migration.

Version ten adds `enclosure.clearing.footprint`, the course's own footprint
(`min` and `max` corners in course x and z). With it, the habitat floor of
the course's clearing is drawn and drivable outside the footprint
(`course-clearing.ts`); without it, nothing outside the course exists. The
footprint stays within 200 m of the placement,
and the course must be turned square to
the axis, so the footprint meets the floor along straight edges. Falls View
Park's footprint is its perimeter walls' outer faces. Version-nine documents
upgrade unchanged.

Coordinates and dimensions are finite and bounded to the accepted authoring
envelope. Unknown fields and unsupported enum values fail rather than being
silently stripped. The complete document validates before scene construction.

## Legacy Normalization

Stored revisions are immutable, so `parseCourseDocument` keeps strict
version-one to version-nine schemas and normalizes them in memory to version
ten; canonical serialization and every new save use version ten. Version
four allows mirror angles only up to 85° and no lamps, version five no
indoor, overhead, or arc objects and no tunnel lamps, and version six no
planting or hedges and at most eight floodlights, and version seven no
water, gravel, concrete, work lamps, or bicycles and at most sixteen indoor
lamps, and version eight no street lamps, and version nine no clearing; all
upgrade unchanged.
Version two adds
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
  new version-ten revision. Persistence responses report the normalized schema
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
  infield turf, lawn, paint), never by separating their heights; the bias's
  slope term stays small so a layer cannot draw over a ramp's thin toe.
  Thin, level layers draw only their top face, so the slope-scaled bias
  cannot pull hidden side faces through as seams.
- Thick grass (earthworks such as a berm) draws unbiased, like the base
  ground. `line` and `hazard` keep their bias at any thickness, and seen at a
  grazing angle it pulls a box forward by centimetres, more at a distance:
  never place one directly behind unbiased detail (a door frame behind its
  door, a painted board behind dark chevrons). Put the biased finish in
  front, or beside, instead.
- A road that curves while it slopes twists, so flat boxes along it meet
  with lips at its edges, and even millimetre lips show as dark lines across
  it. Build such a road from 0.3 m pieces whose drivable top is a 0.2 mm
  skin carrying the collider, over a visual slab 1 cm below that reaches
  under its fill's level tops, the fill set back 2 cm (Falls View Park's
  downhill).
- Earthworks built from tilted slabs fill concave corners correctly (the
  surface is the highest slope), but a convex corner needs the lowest, and
  overlapping slabs leave lips that show as dark lines. Plan visible
  earthworks with concave corners only (Falls View Park's chamber has a
  chamfered inner wall for this), and keep any convex corner, such as the
  berm's far corner fan, out of the main sightlines.
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
- Box, cylinder, and arc are the approved primitives; ramps and other palette
  entries are presets over them. Arcs are walls only: curved decks, rising and
  banked arcs are not yet supported. New primitive kinds need runtime,
  collision, and round-trip evidence.
- Arbitrary placeable lights, skyboxes, fog, and post-processing are deferred.
- Wheel contacts jitter at speed on long elevated decks, so drivable decks
  and roads come in pieces of at most about 20 m.
