# Kart Builder System

**Maturity:** Validated (PRs 3.2–3.5, July 2026).

## Purpose And Scope

This node maps the shipped kart construction pipeline: the portable kart
document, approved part registry, validation, deterministic derivation,
immutable revisions and publication, the admin kart editor, racer usernames,
and the official roster shown in public kart selection. Phase 6 reuses all of
it for community karts.

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
- **Official karts:** `official-kart-assembly.ts`, the
  `balanced-/speed-/handling-kart-document.ts` bundled documents, and
  `official-kart-roster.ts` (IDs, roster schema, bundled fallback roster).
- **Persistence:** `src/db/schema.ts` and `drizzle/0011`–`0013`;
  `src/server/kart-repository.ts` (optimistic-concurrency saves, append-only
  publish/unpublish events, published-revision and thumbnail lookup);
  `src/game/kart/kart-publication.ts` (persisted and public runtime shapes).
- **Roster and identity:** `src/server/official-kart-roster.ts` resolves each
  official kart's live publication with an `@username` assembler credit;
  `src/server/racer-identity.ts` and `src/app/api/profile/route.ts` own one-time
  racer username claims.
- **Routes:** `src/app/api/admin/karts/[kartId]/` (draft load/save,
  publication, revision thumbnails), `src/app/api/karts/[kartId]/` (published
  revision and thumbnail), and `src/app/api/karts/official/route.ts`.
- **Editor:** `src/app/admin/karts/` (roster page and per-kart editor);
  `src/components/kart-editor/` (access, shell, canvas, admin roster,
  post-save thumbnail capture); `src/game/editor/kart-editor-document.ts`
  (selection, transforms, attachment tolerance, mirror pairs, nudges, primitive
  geometry) and `kart-editor-scene.ts` (PlayCanvas projection, picking,
  gizmos, shared editor camera).
- **Selection:** `src/components/play-home.tsx` loads the official roster,
  falls back to the bundled roster, and starts the race with the chosen
  revision's resolved snapshot.

## Flow

1. The editor edits a validated document through document commands. Live
   validation shows path-addressed issues and a derived preview.
2. Save sends only `{ document, expectedRevision }`. The server validates,
   derives, hashes, and appends an immutable revision; a stale expectation
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
- Persistence and APIs: `tests/kart-persistence.spec.ts`,
  `official-kart-roster-api.spec.ts`, `official-kart-roster.spec.ts`.
- Browser: `tests/kart-editor.spec.ts`, `official-kart-admin-roster.spec.ts`,
  and kart selection in `tests/home.spec.ts`.
- `pnpm db:check` for migrations.

## Known Limits

Open items from the Phase 3 integration review live in
`IMPLEMENTATION_PLAN.md` ("Deferred Phase 3 Findings"). The ones that touch this
system: the bundled-roster fallback triggers on any error rather than only when
the database is unreachable; official vs. community karts are not yet a
server-owned field; `no-store`, request-size caps, and strict revision parsing
need hardening before Phase 6; and race and editor still build kart visuals
separately.
