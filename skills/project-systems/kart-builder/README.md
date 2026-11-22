# Kart Builder System

**Maturity:** Validated (PRs 3.2–3.5, July 2026).

## Purpose And Scope

This node maps the shipped kart construction pipeline: the portable kart
document, approved part registry, validation, deterministic derivation,
immutable revisions and publication, the admin kart editor, racer usernames,
and the official roster shown in public kart selection. Community karts will
reuse all of it.

`docs/kart-system/` is the authority for the layered architecture, document
contract, catalog, derivation formulas, persistence records, and versioning.
Runtime handling lives in [`kart-physics`](../kart-physics/README.md);
revision-bound previews live in [`kart-thumbnails`](../kart-thumbnails/README.md).

## Source Ownership

- **Document and catalog:** `src/game/kart/kart-assembly-document.ts` (versioned
  Zod schema), `kart-component-registry.ts` and `kart-material-registry.ts`
  (approved immutable `id@version` definitions, deep-frozen via
  `immutable-registry.ts`), `kart-suspension-mounting.ts`, and
  `kart-catalog-documentation.ts` (rendered into
  `docs/kart-system/generated-catalog.md` by `scripts/generate-kart-catalog.ts`).
- **Validation and derivation:** `kart-assembly-validation.ts` (structural and
  attachment rules with path-addressed issues), `kart-construction-geometry.ts`
  (mass elements and bounds), and `kart-derivation.ts` (versioned
  `deriveKartSnapshot`, wheel stations, physical profile, canonical
  serialization, and SHA-256 hash).
- **Official karts:** `official-kart-assembly.ts` builds each as an open 1:10
  RC chassis from its config, laid out as
  [visual identity](../../../docs/visual-identity.md#materials) describes, with
  the plate as structural root and suspensions on the shock towers'
  crossbars. Every attachment names its mounting points, and no parts clash
  through full travel and lock (tested). Every shock leans 30° inward
  from its arm eye's travel, on coilover versions rated for that
  installation. The `balanced-/speed-/handling-kart-document.ts` configs own
  arm length, motion ratio, plate, and equipment placement;
  `official-kart-roster.ts` owns IDs, the roster schema, and the bundled
  fallback roster.
- **Persistence:** `src/db/schema.ts` and `drizzle/0011`–`0013`;
  `src/server/kart-repository.ts` (optimistic-concurrency saves, append-only
  publish/unpublish events, published-revision and thumbnail lookup);
  `src/game/kart/kart-publication.ts` (persisted and public runtime shapes).
- **Roster and identity:** `src/server/official-kart-roster.ts` resolves each
  official kart's live publication with an `@username` assembler credit; a
  kart that fails to load is logged and dropped, and the bundled roster is a
  last resort;
  `src/server/racer-identity.ts` and `src/app/api/profile/route.ts` own one-time
  racer username claims.
- **Routes:** `src/app/api/admin/karts/[kartId]/` (draft load/save,
  publication, revision thumbnails), `src/app/api/karts/[kartId]/` (published
  revision and thumbnail), and `src/app/api/karts/official/route.ts`.
- **Visuals:** `src/game/kart/kart-assembly-visual.ts` is the one
  presentation-only builder for race, editor, and thumbnails. It returns
  per-instance roots (editor selection) and a wheel and suspension rig the race
  poses each frame with `poseKartWheelVisual`. Rig parts sit in assembly axes,
  so wheel instance rotation is not drawn, matching derivation. The steering
  controller turns the same wheel pivots, and the race spins each wheel on a
  `spin` entity under its pivot. Wheel pieces in the two wheel finishes
  carry their lathe stations (`profile`, drawn as UV1) and get the wheel's
  index in vertex alpha; a wheel visual without `profile` shows no tread,
  spoke, or lettering detail. Materials belong to the caller.
  Physics never reads these entities.
- **Mounting and fit:** `kart-mounting.ts` lists each instance's named
  mounting points and the rules for two to meet; `kart-mount-snapping.ts`
  seats a part on a parent's point and finds the nearest snap.
  `kart-clearance.ts` measures parts' solid shapes (with
  `kart-convex-distance.ts`), sweeps tie rods and driveshafts
  (`kart-linkage-poses.ts`, shared with the visual) through travel and lock,
  poses the kart for the builder's views, and measures the gap between two
  parts. `kart-assembly-fit.ts` is the save gate's check, which the
  builder also runs in its worker.
- **Linkages:** `kart-linkages.ts` plans a tie rod for each wheel connected
  to a steering servo and a dogbone for each wheel connected to a
  transmission, where the part's CAD mesh names the attachment points;
  `kart-linkage-visual-geometry.ts` builds them, and `poseKartWheelVisual`
  poses them with the wheel (callers turn a pivot before posing it). A
  driven wheel's arm is drawn below its pivots to pass under the dogbone.
- **Wiring:** `kart-wiring.ts` routes a cable for each wire of a functional
  connection whose two ports say where their wires leave
  (`getKartPartLeads`: CAD `lead-*` points, see `cad/README.md`, or the
  battery, controller, and brakes builders' leads), clear of parts and
  linkages. The assembly visual draws them as one entity
  (`createKartCablesEntity`) in the shared black and authored polymer
  materials, so a race draws no more; the editor rebuilds it as a drag
  previews (once a frame, held to the drop when routing runs slow), hides
  it in Explode, and fades it in X-ray. Cables are presentation only: no
  document field, and not in the clearance check or save gate.
- **Part visuals:** `kart-part-visuals.ts` maps every approved `id@version`
  to code-built geometry in `kart-part-visual-geometry.ts` or to a CAD mesh
  (one piece per finish, in the part's frame). CAD meshes are written by
  build123d models in `cad/parts/` and committed to `cad-meshes/`;
  `kart-cad-meshes.ts` reads them, and their measured mass is a report only
  ([`build123d-cad`](../../tools/build123d-cad/README.md)). Visuals are not fingerprinted; changing one
  advances the thumbnail render version. A part version without a visual falls
  back to its construction primitives. Coilovers are sized from their
  suspension definition and posed from the mounts: the body rides the chassis
  eye, the shaft the spring-arm eye, and the spring stretches between seats.
  Primitives take a finish from their construction material and a form from
  their role in `kart-primitive-visual-geometry.ts`, built at true size: a box
  root keeps its size as scale (the editor gizmo) and its visual child
  undoes it, so committed resizes rebuild detail and drag previews stretch.
  A CAD mesh may also carry moving pieces (the servo's horn), which the
  assembly visual draws under the part and poses, and named points where
  linkages attach.
  Visuals stay inside construction envelopes except the motor shaft and terminals, the
  servo horn's ball studs (and the horn as it turns), the
  wheel retaining collar, and suspension rig parts, linkages, and cables,
  which are posed from mounts and connections rather than construction
  shapes.
- **Editor:** `src/app/admin/karts/` (roster page and per-kart editor);
  `src/components/kart-editor/` (access, shell, canvas, admin roster,
  post-save thumbnail capture); `src/game/editor/kart-editor-document.ts`
  (selection, transforms, attachment tolerance, mirror pairs, nudges, primitive
  geometry; new primitives spawn on the structural root's top face; variant
  swaps keep each suspension's authored mounts; a part dropped or attached
  near a matching mounting point snaps, and a snapped part moves only as its
  mount allows) and `kart-editor-scene.ts` (PlayCanvas projection, picking,
  gizmos, shared editor camera, and the Explode, Motion, X-ray, and Measure
  views). `kart-explode.ts` lifts each part off its mount face;
  `kart-editor-view-controls.tsx` holds the view bar, explode slider, and
  motion pad; `use-kart-fit-check.ts` and `kart-fit.worker.ts` check fit off
  the main thread as edits settle.
- **Selection:** `src/components/play-home.tsx` loads the official roster,
  falls back to the bundled roster, and starts the race with the chosen
  revision's resolved snapshot.

## Flow

1. The editor edits a validated document through document commands. Live
   validation shows path-addressed issues, whether the parts fit as Save
   requires, and a derived preview. Official
   karts can load their bundled design as an undoable change.
2. Save sends only `{ document, expectedRevision }`. The server validates,
   checks fit, derives, hashes, and appends an immutable revision; a stale expectation
   conflicts.
3. Publish or unpublish appends an event against the expected latest event.
4. The public roster serves each official kart's live revision (source,
   snapshot, hash, credit, thumbnail availability) with `no-store`.
5. A race runs the selected revision's resolved snapshot exactly.

## Accepted Invariants

- Builders place approved parts. They never edit mass, grip, force, spring
  rate, inertia, or any resolved statistic, and no stat override exists.
- A published part version never changes in place. Registry fingerprints are
  pinned by `tests/kart-registry-immutability.spec.ts`; changes add a new
  version.
- Derivation runs on the server, and client-supplied snapshots are rejected.
  Reads re-verify version metadata and hash and fail closed.
- Revisions and publication events are immutable at the database boundary.
  Older derivation versions keep their parsers so historical hashes still
  verify. The editor allows re-saving an unedited draft from an older
  derivation version.
- Only the server-verified `admin` role can save or publish today.
  "Assembler" is a capability, not a role.
- Public responses omit ownership, author, and publication-actor IDs beyond
  the assembler credit.
- Kart parts have no progression tiers.

## Verification

- Document, registry, validation, derivation:
  `tests/kart-assembly-document.spec.ts`, `kart-component-registry.spec.ts`,
  `kart-assembly-validation.spec.ts`, `kart-derivation.spec.ts`,
  `kart-registry-immutability.spec.ts`, `balanced-kart-document.spec.ts`, and
  `kart-editor-document.spec.ts`.
- Mounting, fit, and views: `tests/kart-mounting.spec.ts`,
  `kart-clearance.spec.ts`, and `kart-builder-views.spec.ts`.
- Wiring: `tests/kart-wiring.spec.ts` (and its triangles in
  `kart-visual-budget.spec.ts`).
- Persistence and APIs: `tests/kart-persistence.spec.ts`,
  `official-kart-roster-api.spec.ts`, `official-kart-roster.spec.ts`.
- Browser: `tests/kart-editor.spec.ts`, `official-kart-admin-roster.spec.ts`,
  and kart selection in `tests/home.spec.ts`.
- `pnpm db:check` for migrations.

## Known Limits

Official vs. community status is not server-owned and request hardening is
incomplete. Community kart publishing must fix both.

Swapping an official kart's gearbox for a taller one (from 4:1 to 5:1 or
8:1, or from 5:1 to 8:1) runs it into the top deck, so the kart can't be
saved until the deck is raised. The 8:1's outputs sit 2 mm higher than the
4:1's and 5:1's, so a swap to or from it moves the driveshafts by that much.

Tie rods stretch to reach their steering arms: about 1% at 20° of steering and up to
3% at full lock. While an editor drag previews a wheel, servo, or
transmission, its linkages (like its coilover) stay put until the drag is
committed and the kart is rebuilt.

Cables keep clear of parts and linkages but not entirely of each other:
where leads fan into a port, or one leaves its port under a bundle laid
tight against its part, wires can press into each other by a millimetre or
two. A lead whose port has no room to leave, or that would run through a
part crowding its port, is not drawn.

Thin solid primitives (2 mm plates) are collision geometry too. Above top
speed a kart can travel farther per physics step than a thin wall is deep,
and the solver may push it into the floor; PR 4.2.3 owns the fix.

Derivation counts shock tilt: shock travel is the installation ratio (motion
ratio × the cosine of the shock's angle to its arm eye's travel) × wheel
travel, so the drawn coilover compresses as the physics does.
