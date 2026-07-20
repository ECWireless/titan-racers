import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  kartPublicationEvents,
  kartRevisions,
  karts,
  type KartPublicationAction,
} from "@/db/schema";
import {
  type KartAssemblyDocument,
  parseKartAssemblyDocument,
} from "@/game/kart/kart-assembly-document";
import { parseValidatedKartAssembly } from "@/game/kart/kart-assembly-validation";
import {
  deriveKartSnapshot,
  hashResolvedKartSnapshot,
  parseResolvedKartSnapshot,
  type ResolvedKartSnapshot,
} from "@/game/kart/kart-derivation";

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

export type PersistedKartRevision = {
  authorUserId: string;
  createdAt: Date;
  derivationVersion: number;
  document: KartAssemblyDocument;
  kartId: string;
  ownerUserId: string;
  resolvedSnapshot: ResolvedKartSnapshot;
  resolvedSnapshotHash: string;
  revision: number;
  schemaVersion: number;
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
  publication: PersistedKartPublicationEvent & {
    action: "publish";
    revision: number;
  };
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
};

async function parseRevisionRow(
  row: Omit<PersistedKartRevision, "document" | "resolvedSnapshot"> & {
    document: unknown;
    resolvedSnapshot: unknown;
  },
): Promise<PersistedKartRevision> {
  const document = parseKartAssemblyDocument(row.document);
  const resolvedSnapshot = parseResolvedKartSnapshot(row.resolvedSnapshot);

  if (
    row.kartId !== document.kartId ||
    row.schemaVersion !== document.schemaVersion ||
    resolvedSnapshot.kartId !== document.kartId ||
    resolvedSnapshot.derivationVersion !== row.derivationVersion
  ) {
    throw new Error("Persisted kart derivation evidence is inconsistent.");
  }
  if ((await hashResolvedKartSnapshot(resolvedSnapshot)) !== row.resolvedSnapshotHash) {
    throw new Error("Persisted kart derivation evidence hash does not match.");
  }

  return { ...row, document, resolvedSnapshot };
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
      resolvedSnapshot: resolvedSnapshot as ResolvedKartSnapshot,
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
  });

  return {
    ...revision,
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
      .select({ revision: kartRevisions.revision })
      .from(kartRevisions)
      .where(
        and(
          eq(kartRevisions.kartId, input.kartId),
          eq(kartRevisions.revision, input.revision),
        ),
      )
      .limit(1);
    if (!revision) throw new KartPublicationTargetError();

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
