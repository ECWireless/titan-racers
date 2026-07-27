import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  kartPublicationEvents,
  kartRevisionThumbnails,
  kartRevisions,
  karts,
  type KartPublicationAction,
  users,
} from "@/db/schema";
import {
  type KartAssemblyDocument,
  kartAssemblyDocumentVersionSchema,
  parseKartAssemblyDocument,
} from "@/game/kart/kart-assembly-document";
import { parseValidatedKartAssembly } from "@/game/kart/kart-assembly-validation";
import {
  deriveKartSnapshot,
  hashResolvedKartSnapshot,
  parseResolvedKartSnapshot,
  type PersistedResolvedKartSnapshot,
} from "@/game/kart/kart-derivation";
import type { DeepReadonly } from "@/game/kart/immutable-registry";
import { validateKartThumbnailImageData } from "@/server/kart-thumbnail";

export class KartConflictError extends Error {
  constructor() {
    super("The persisted kart changed after the requested base revision.");
    this.name = "KartConflictError";
  }
}

export class KartPublicationConflictError extends Error {
  constructor() {
    super("The kart publication changed after the requested publication base.");
    this.name = "KartPublicationConflictError";
  }
}

export class KartPublicationTargetError extends Error {
  constructor() {
    super("The requested kart, saved revision, or publication does not exist.");
    this.name = "KartPublicationTargetError";
  }
}

export class KartThumbnailConflictError extends Error {
  constructor() {
    super("A different thumbnail already exists for this immutable revision.");
    this.name = "KartThumbnailConflictError";
  }
}

export class KartThumbnailTargetError extends Error {
  constructor() {
    super("The requested kart revision does not exist.");
    this.name = "KartThumbnailTargetError";
  }
}

export type PersistedKartRevision = {
  authorUserId: string;
  createdAt: Date;
  derivationVersion: number;
  document: KartAssemblyDocument;
  kartId: string;
  ownerUserId: string;
  resolvedSnapshot: DeepReadonly<PersistedResolvedKartSnapshot>;
  resolvedSnapshotHash: string;
  revision: number;
  schemaVersion: number;
  thumbnailAvailable: boolean;
};

export type PersistedKartPublicationEvent = {
  action: KartPublicationAction;
  actorUserId: string;
  eventId: number;
  kartId: string;
  occurredAt: Date;
  revision: number | null;
};

export type PersistedPublishedKartRevision = PersistedKartRevision & {
  authorUsername: string | null;
  publication: PersistedKartPublicationEvent & {
    action: "publish";
    revision: number;
  };
};

export type PersistedKartRevisionThumbnail = {
  contentType: "image/png";
  createdAt: Date;
  generatedByUserId: string;
  imageData: Buffer;
  imageSha256: string;
  kartId: string;
  renderVersion: number;
  revision: number;
};

const revisionSelection = {
  authorUserId: kartRevisions.authorUserId,
  createdAt: kartRevisions.createdAt,
  derivationVersion: kartRevisions.derivationVersion,
  document: kartRevisions.document,
  kartId: kartRevisions.kartId,
  ownerUserId: karts.ownerUserId,
  resolvedSnapshot: kartRevisions.resolvedSnapshot,
  resolvedSnapshotHash: kartRevisions.resolvedSnapshotHash,
  revision: kartRevisions.revision,
  schemaVersion: kartRevisions.schemaVersion,
  thumbnailAvailable: sql<boolean>`${kartRevisionThumbnails.revisionId} is not null`,
};

async function parseRevisionRow(
  row: Omit<PersistedKartRevision, "document" | "resolvedSnapshot"> & {
    document: unknown;
    resolvedSnapshot: unknown;
  },
): Promise<PersistedKartRevision> {
  const storedDocument = kartAssemblyDocumentVersionSchema.parse(row.document);
  const document = parseKartAssemblyDocument(storedDocument);
  const resolvedSnapshot = parseResolvedKartSnapshot(row.resolvedSnapshot);

  if (
    row.kartId !== document.kartId ||
    row.schemaVersion !== storedDocument.schemaVersion ||
    resolvedSnapshot.kartId !== document.kartId ||
    resolvedSnapshot.derivationVersion !== row.derivationVersion
  ) {
    throw new Error("Persisted kart derivation evidence is inconsistent.");
  }
  if ((await hashResolvedKartSnapshot(resolvedSnapshot)) !== row.resolvedSnapshotHash) {
    throw new Error("Persisted kart derivation evidence hash does not match.");
  }

  return {
    ...row,
    document,
    resolvedSnapshot,
    schemaVersion: document.schemaVersion,
  };
}

export async function loadLatestKartRevision(
  kartId: string,
): Promise<PersistedKartRevision | null> {
  const [row] = await db
    .select(revisionSelection)
    .from(karts)
    .innerJoin(
      kartRevisions,
      and(
        eq(kartRevisions.kartId, karts.id),
        eq(kartRevisions.revision, karts.currentRevision),
      ),
    )
    .leftJoin(
      kartRevisionThumbnails,
      eq(kartRevisionThumbnails.revisionId, kartRevisions.id),
    )
    .where(eq(karts.id, kartId))
    .limit(1);

  return row ? await parseRevisionRow(row) : null;
}

export async function saveKartRevision(input: {
  authorUserId: string;
  document: unknown;
  expectedRevision: number | null;
  ownerUserId: string;
}): Promise<PersistedKartRevision> {
  const document = parseValidatedKartAssembly(input.document).document;
  const resolvedSnapshot = deriveKartSnapshot(document);
  const resolvedSnapshotHash = await hashResolvedKartSnapshot(resolvedSnapshot);
  const nextRevision = (input.expectedRevision ?? 0) + 1;

  return db.transaction(async (transaction) => {
    let ownerUserId = input.ownerUserId;

    if (input.expectedRevision === null) {
      const inserted = await transaction
        .insert(karts)
        .values({
          createdByUserId: input.authorUserId,
          currentRevision: nextRevision,
          id: document.kartId,
          ownerUserId: input.ownerUserId,
        })
        .onConflictDoNothing()
        .returning({ id: karts.id });

      if (inserted.length === 0) throw new KartConflictError();
    } else {
      const advanced = await transaction
        .update(karts)
        .set({ currentRevision: nextRevision })
        .where(
          and(
            eq(karts.id, document.kartId),
            eq(karts.currentRevision, input.expectedRevision),
          ),
        )
        .returning({ id: karts.id, ownerUserId: karts.ownerUserId });

      if (advanced.length === 0) throw new KartConflictError();
      ownerUserId = advanced[0].ownerUserId;
    }

    const [revision] = await transaction
      .insert(kartRevisions)
      .values({
        authorUserId: input.authorUserId,
        derivationVersion: resolvedSnapshot.derivationVersion,
        document,
        id: randomUUID(),
        kartId: document.kartId,
        resolvedSnapshot,
        resolvedSnapshotHash,
        revision: nextRevision,
        schemaVersion: document.schemaVersion,
      })
      .returning({
        authorUserId: kartRevisions.authorUserId,
        createdAt: kartRevisions.createdAt,
        derivationVersion: kartRevisions.derivationVersion,
        kartId: kartRevisions.kartId,
        resolvedSnapshotHash: kartRevisions.resolvedSnapshotHash,
        revision: kartRevisions.revision,
        schemaVersion: kartRevisions.schemaVersion,
      });

    return {
      ...revision,
      document,
      ownerUserId,
      resolvedSnapshot,
      thumbnailAvailable: false,
    };
  });
}

export async function loadLatestKartPublicationEvent(
  kartId: string,
): Promise<PersistedKartPublicationEvent | null> {
  const [row] = await db
    .select({
      action: kartPublicationEvents.action,
      actorUserId: kartPublicationEvents.actorUserId,
      eventId: kartPublicationEvents.id,
      kartId: kartPublicationEvents.kartId,
      occurredAt: kartPublicationEvents.createdAt,
      revision: kartPublicationEvents.revision,
    })
    .from(kartPublicationEvents)
    .where(eq(kartPublicationEvents.kartId, kartId))
    .orderBy(desc(kartPublicationEvents.id))
    .limit(1);

  return row ?? null;
}

export async function loadPublishedKartRevision(
  kartId: string,
): Promise<PersistedPublishedKartRevision | null> {
  const [row] = await db
    .select({
      action: kartPublicationEvents.action,
      actorUserId: kartPublicationEvents.actorUserId,
      authorUsername: users.username,
      authorUserId: kartRevisions.authorUserId,
      createdAt: kartRevisions.createdAt,
      derivationVersion: kartRevisions.derivationVersion,
      document: kartRevisions.document,
      eventId: kartPublicationEvents.id,
      kartId: kartPublicationEvents.kartId,
      occurredAt: kartPublicationEvents.createdAt,
      ownerUserId: karts.ownerUserId,
      resolvedSnapshot: kartRevisions.resolvedSnapshot,
      resolvedSnapshotHash: kartRevisions.resolvedSnapshotHash,
      revision: kartPublicationEvents.revision,
      schemaVersion: kartRevisions.schemaVersion,
      thumbnailAvailable: sql<boolean>`${kartRevisionThumbnails.revisionId} is not null`,
    })
    .from(kartPublicationEvents)
    .leftJoin(
      kartRevisions,
      and(
        eq(kartRevisions.kartId, kartPublicationEvents.kartId),
        eq(kartRevisions.revision, kartPublicationEvents.revision),
      ),
    )
    .innerJoin(karts, eq(karts.id, kartPublicationEvents.kartId))
    .leftJoin(users, eq(users.id, kartRevisions.authorUserId))
    .leftJoin(
      kartRevisionThumbnails,
      eq(kartRevisionThumbnails.revisionId, kartRevisions.id),
    )
    .where(eq(kartPublicationEvents.kartId, kartId))
    .orderBy(desc(kartPublicationEvents.id))
    .limit(1);
  if (
    !row ||
    row.action !== "publish" ||
    !row.revision ||
    !row.authorUserId ||
    !row.createdAt ||
    !row.derivationVersion ||
    !row.document ||
    !row.resolvedSnapshot ||
    !row.resolvedSnapshotHash ||
    !row.schemaVersion
  ) {
    return null;
  }

  const revision = await parseRevisionRow({
    authorUserId: row.authorUserId,
    createdAt: row.createdAt,
    derivationVersion: row.derivationVersion,
    document: row.document,
    kartId: row.kartId,
    ownerUserId: row.ownerUserId,
    resolvedSnapshot: row.resolvedSnapshot,
    resolvedSnapshotHash: row.resolvedSnapshotHash,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    thumbnailAvailable: row.thumbnailAvailable,
  });

  return {
    ...revision,
    authorUsername: row.authorUsername,
    publication: {
      action: "publish",
      actorUserId: row.actorUserId,
      eventId: row.eventId,
      kartId: row.kartId,
      occurredAt: row.occurredAt,
      revision: row.revision,
    },
  };
}

const thumbnailSelection = {
  contentType: kartRevisionThumbnails.contentType,
  createdAt: kartRevisionThumbnails.createdAt,
  generatedByUserId: kartRevisionThumbnails.generatedByUserId,
  imageData: kartRevisionThumbnails.imageData,
  imageSha256: kartRevisionThumbnails.imageSha256,
  kartId: kartRevisions.kartId,
  renderVersion: kartRevisionThumbnails.renderVersion,
  revision: kartRevisions.revision,
};

export async function loadKartRevisionThumbnail(
  kartId: string,
  revision: number,
): Promise<PersistedKartRevisionThumbnail | null> {
  const [row] = await db
    .select(thumbnailSelection)
    .from(kartRevisionThumbnails)
    .innerJoin(
      kartRevisions,
      eq(kartRevisions.id, kartRevisionThumbnails.revisionId),
    )
    .where(
      and(
        eq(kartRevisions.kartId, kartId),
        eq(kartRevisions.revision, revision),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.contentType !== "image/png") {
    throw new Error("Persisted kart thumbnail content type is invalid.");
  }
  return { ...row, contentType: row.contentType };
}

export async function saveKartRevisionThumbnail(input: {
  contentType: "image/png";
  generatedByUserId: string;
  imageData: Buffer;
  kartId: string;
  renderVersion: number;
  revision: number;
}): Promise<PersistedKartRevisionThumbnail> {
  validateKartThumbnailImageData(input.imageData);
  const imageSha256 = createHash("sha256").update(input.imageData).digest("hex");
  return db.transaction(async (transaction) => {
    const [revision] = await transaction
      .select({ id: kartRevisions.id })
      .from(kartRevisions)
      .where(
        and(
          eq(kartRevisions.kartId, input.kartId),
          eq(kartRevisions.revision, input.revision),
        ),
      )
      .limit(1);
    if (!revision) throw new KartThumbnailTargetError();

    const [inserted] = await transaction
      .insert(kartRevisionThumbnails)
      .values({
        contentType: input.contentType,
        generatedByUserId: input.generatedByUserId,
        imageData: input.imageData,
        imageSha256,
        renderVersion: input.renderVersion,
        revisionId: revision.id,
      })
      .onConflictDoNothing()
      .returning({
        contentType: kartRevisionThumbnails.contentType,
        createdAt: kartRevisionThumbnails.createdAt,
        generatedByUserId: kartRevisionThumbnails.generatedByUserId,
        imageData: kartRevisionThumbnails.imageData,
        imageSha256: kartRevisionThumbnails.imageSha256,
        renderVersion: kartRevisionThumbnails.renderVersion,
      });
    if (inserted) {
      return {
        ...inserted,
        contentType: "image/png",
        kartId: input.kartId,
        revision: input.revision,
      };
    }

    const [existing] = await transaction
      .select({
        contentType: kartRevisionThumbnails.contentType,
        createdAt: kartRevisionThumbnails.createdAt,
        generatedByUserId: kartRevisionThumbnails.generatedByUserId,
        imageData: kartRevisionThumbnails.imageData,
        imageSha256: kartRevisionThumbnails.imageSha256,
        renderVersion: kartRevisionThumbnails.renderVersion,
      })
      .from(kartRevisionThumbnails)
      .where(eq(kartRevisionThumbnails.revisionId, revision.id))
      .limit(1);
    if (
      !existing ||
      existing.contentType !== input.contentType ||
      existing.imageSha256 !== imageSha256 ||
      existing.renderVersion !== input.renderVersion
    ) {
      throw new KartThumbnailConflictError();
    }
    return {
      ...existing,
      contentType: input.contentType,
      kartId: input.kartId,
      revision: input.revision,
    };
  });
}

function publicationEventSelection() {
  return {
    action: kartPublicationEvents.action,
    actorUserId: kartPublicationEvents.actorUserId,
    eventId: kartPublicationEvents.id,
    kartId: kartPublicationEvents.kartId,
    occurredAt: kartPublicationEvents.createdAt,
    revision: kartPublicationEvents.revision,
  };
}

export async function publishKartRevision(input: {
  actorUserId: string;
  expectedPublicationEventId: number | null;
  kartId: string;
  revision: number;
}): Promise<PersistedKartPublicationEvent> {
  return db.transaction(async (transaction) => {
    const [kart] = await transaction
      .select({ id: karts.id })
      .from(karts)
      .where(eq(karts.id, input.kartId))
      .for("update")
      .limit(1);
    if (!kart) throw new KartPublicationTargetError();

    const [latest] = await transaction
      .select(publicationEventSelection())
      .from(kartPublicationEvents)
      .where(eq(kartPublicationEvents.kartId, input.kartId))
      .orderBy(desc(kartPublicationEvents.id))
      .limit(1);
    if ((latest?.eventId ?? null) !== input.expectedPublicationEventId) {
      throw new KartPublicationConflictError();
    }

    const [revision] = await transaction
      .select({
        resolvedSnapshot: kartRevisions.resolvedSnapshot,
        revision: kartRevisions.revision,
      })
      .from(kartRevisions)
      .where(
        and(
          eq(kartRevisions.kartId, input.kartId),
          eq(kartRevisions.revision, input.revision),
        ),
      )
      .limit(1);
    if (!revision) throw new KartPublicationTargetError();
    parseResolvedKartSnapshot(revision.resolvedSnapshot);

    if (latest?.action === "publish" && latest.revision === input.revision) {
      return latest;
    }

    const [publication] = await transaction
      .insert(kartPublicationEvents)
      .values({
        action: "publish",
        actorUserId: input.actorUserId,
        kartId: input.kartId,
        revision: input.revision,
      })
      .returning(publicationEventSelection());
    return publication;
  });
}

export async function unpublishKart(input: {
  actorUserId: string;
  expectedPublicationEventId: number | null;
  kartId: string;
}): Promise<PersistedKartPublicationEvent> {
  return db.transaction(async (transaction) => {
    const [kart] = await transaction
      .select({ id: karts.id })
      .from(karts)
      .where(eq(karts.id, input.kartId))
      .for("update")
      .limit(1);
    if (!kart) throw new KartPublicationTargetError();

    const [latest] = await transaction
      .select(publicationEventSelection())
      .from(kartPublicationEvents)
      .where(eq(kartPublicationEvents.kartId, input.kartId))
      .orderBy(desc(kartPublicationEvents.id))
      .limit(1);
    if ((latest?.eventId ?? null) !== input.expectedPublicationEventId) {
      throw new KartPublicationConflictError();
    }
    if (!latest) throw new KartPublicationTargetError();
    if (latest.action === "unpublish") return latest;

    const [publication] = await transaction
      .insert(kartPublicationEvents)
      .values({
        action: "unpublish",
        actorUserId: input.actorUserId,
        kartId: input.kartId,
        revision: null,
      })
      .returning(publicationEventSelection());
    return publication;
  });
}
