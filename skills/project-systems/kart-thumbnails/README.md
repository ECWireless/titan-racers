# Kart Thumbnail System

## Status

**Maturity:** In review. PR 3.5 implementation, migration, focused persistence,
desktop/mobile roster, editor capture, and race-start regression coverage are
complete. Feature-lead QA and the final independent review gate remain.

## Purpose And Scope

This system gives every saved kart revision an exact visual preview made from
the same procedural assembly used by the editor. Admin selection shows the
latest draft revision, while player selection shows only the currently
published revision. Saving a newer private draft therefore cannot change the
public image.

The system owns capture, validation, immutable storage, protected draft
delivery, public published delivery, fallback rendering, and card
presentation. Kart authoring and publication remain owned by the kart editor
and repository; racing remains owned by the solo runtime.

## Source Ownership

- `src/game/kart/kart-assembly-visual.ts` constructs the shared visual assembly
  and reports its rendered bounds without owning application or material
  lifecycle.
- `src/game/kart/kart-thumbnail-contract.ts` defines the fixed image dimensions,
  PNG content type, byte bound, and renderer version.
- `src/game/kart/kart-thumbnail-renderer.ts` owns serialized, fixed-camera
  PlayCanvas capture and waits for capture teardown before the race creates its
  own PlayCanvas application.
- `src/components/kart-thumbnail.tsx` presents a persisted image when available,
  otherwise renders the exact supplied document locally, with an explicit
  uninitialized placeholder.
- `src/components/kart-editor/persist-kart-thumbnail.ts` performs best-effort
  post-save capture and upload. A failed capture never discards a successful
  kart revision.
- `src/db/schema.ts`, `src/server/kart-repository.ts`, and
  `drizzle/0013_kart_revision_thumbnails.sql` own immutable, revision-keyed PNG
  storage and lookup.
- `src/app/api/admin/karts/[kartId]/revisions/[revision]/thumbnail/route.ts`
  owns authenticated exact-revision reads and same-origin writes.
- `src/app/api/karts/[kartId]/thumbnail/route.ts` resolves the current
  publication before returning image bytes and exposes no author or draft
  metadata.

## Revision And Delivery Flow

1. A kart save first creates its immutable JSON revision.
2. The browser captures that exact saved document at the fixed render version
   and submits a bounded PNG to the exact revision endpoint.
3. The repository stores at most one immutable thumbnail for that revision.
   Repeating the identical write is idempotent; different bytes conflict.
4. The admin roster resolves the kart's latest saved revision and requests only
   that revision's protected image.
5. The public route resolves the live publication and returns only that
   revision's image, so later draft captures remain private.
6. If an image is missing, the card renders the exact already-authorized
   document locally. Uninitialized admin entries use a deliberate placeholder.

## Accepted Invariants

- A thumbnail is identified by immutable revision, never only by mutable kart
  ID.
- The admin roster previews the latest saved draft; the player roster previews
  the published revision.
- Saving or capturing a draft cannot mutate the currently published thumbnail.
- The browser capture uses fixed dimensions, camera, lighting, background, and
  a versioned renderer contract.
- Image uploads are authenticated, same-origin JSON mutations with canonical
  base64, PNG signature and dimensions, render-version, and byte-size checks.
- Public delivery includes defensive content headers, immutable-revision ETags,
  and no personal attribution or draft discovery.
- Thumbnail generation is best effort after revision persistence. The saved
  revision remains valid and receives an exact local-render fallback if capture
  or upload fails.
- Thumbnail and race PlayCanvas applications never overlap their teardown and
  startup lifecycles.

## Verification

- `tests/kart-thumbnail.spec.ts` covers upload validation, defensive delivery,
  immutable storage, idempotence, conflicts, authorization, and published
  revision selection.
- `tests/kart-persistence.spec.ts` covers thumbnail availability on latest and
  published revision records.
- `tests/kart-editor.spec.ts` performs real browser PNG capture across save and
  publication workflows.
- `tests/official-kart-admin-roster.spec.ts` covers initialized and placeholder
  cards at desktop and mobile sizes.
- `tests/home.spec.ts` covers published selection and serialized transition
  from fallback rendering into the solo runtime.
- `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` are the static
  and production boundaries.

## Known Limits And Deferred Work

- PNG bytes currently live in Postgres because the official roster and image
  bounds are deliberately small. Object storage can replace byte persistence
  later without changing the revision identity contract.
- Existing revisions without a stored image use exact local rendering until
  their next save or a future explicit backfill.
- Capture uses the procedural primitive assembly. Future imported meshes will
  require the shared visual builder and renderer version to advance together.
