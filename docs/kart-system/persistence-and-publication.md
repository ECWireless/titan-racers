# Kart Persistence And Publication

## Responsibility

Postgres stores ownership and history outside the portable assembly document.
All Phase 3B create, save, publish, and unpublish mutations require a
server-verified `admin` role. The `assembler` role grants no access in this
phase. Mutation routes also require JSON and an allowed same-origin request.

## Records

- `karts` is the mutable head: stable kart ID, current revision, owner, creator,
  and creation time. Ownership exists from the first revision so community
  authorization can be added later without changing the document format.
- `kart_revisions` is immutable authored and derived evidence: source document,
  schema and derivation versions, resolved snapshot, canonical SHA-256 hash,
  author, revision number, and timestamp.
- `kart_publication_events` is an immutable append-only sequence of publish and
  unpublish transitions. Publish events reference an existing saved revision;
  unpublish events carry no revision.

Database constraints preserve valid references and event shape. Triggers reject
updates or deletes to revision and publication history. Saving uses an expected
draft revision; publication changes use the expected latest event ID. A stale
writer receives a conflict instead of overwriting another administrator.

## Server Derivation Boundary

The save API accepts only `{ document, expectedRevision }`. It validates and
derives the snapshot on the server; client-supplied snapshots or statistics are
rejected. Reads parse the persisted versioned snapshot, verify its document and
version metadata, recompute its canonical hash, and fail closed if evidence is
inconsistent.

## Routes

- `GET|PUT /api/admin/karts/:kartId` loads or saves the latest draft.
- `GET|POST /api/admin/karts/:kartId/publication` loads publication state or
  appends a publish/unpublish transition.
- `GET /api/karts/:kartId/published` exposes only the currently published source
  and derived evidence, with `Cache-Control: no-store`. It omits ownership,
  author, and publication-actor identifiers.

PR 3C will add the admin assembly editor and use these contracts to author and
publish the Balanced Kart before replacing the transitional runtime kart.
