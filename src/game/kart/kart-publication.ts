import { z } from "zod";

import { kartAssemblyDocumentSchema, kartStableIdSchema } from "./kart-assembly-document";
import {
  resolvedKartSnapshotV1Schema,
  resolvedKartSnapshotV2Schema,
} from "./kart-derivation";

export const kartPublicationEventSchema = z.strictObject({
  action: z.enum(["publish", "unpublish"]),
  actorUserId: z.string().min(1),
  eventId: z.number().int().positive(),
  kartId: kartStableIdSchema,
  occurredAt: z.string().datetime(),
  revision: z.number().int().positive().nullable(),
});

const persistedKartRevisionBaseSchema = z.strictObject({
  authorUserId: z.string().min(1),
  createdAt: z.string().datetime(),
  derivationVersion: z.number().int().positive(),
  document: kartAssemblyDocumentSchema,
  kartId: kartStableIdSchema,
  ownerUserId: z.string().min(1),
  publication: kartPublicationEventSchema.nullable().default(null),
  resolvedSnapshot: z.union([
    resolvedKartSnapshotV1Schema,
    resolvedKartSnapshotV2Schema,
  ]),
  resolvedSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  revision: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  thumbnailAvailable: z.boolean().default(false),
});

export const persistedKartRevisionSchema =
  persistedKartRevisionBaseSchema.superRefine((revision, context) => {
    if (
      revision.document.kartId !== revision.kartId ||
      revision.resolvedSnapshot.kartId !== revision.kartId ||
      revision.document.schemaVersion !== revision.schemaVersion ||
      revision.resolvedSnapshot.derivationVersion !== revision.derivationVersion
    ) {
      context.addIssue({
        code: "custom",
        message: "Kart revision identity or version evidence is inconsistent.",
      });
    }
  });

export const publishedKartRuntimeSchema = z
  .strictObject({
    derivationVersion: z.number().int().positive(),
    document: kartAssemblyDocumentSchema,
    kartId: kartStableIdSchema,
    publishedAt: z.string().datetime(),
    resolvedSnapshot: z.union([
      resolvedKartSnapshotV1Schema,
      resolvedKartSnapshotV2Schema,
    ]),
    resolvedSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
    revision: z.number().int().positive(),
    schemaVersion: z.number().int().positive(),
    thumbnailAvailable: z.boolean().default(false),
  })
  .superRefine((revision, context) => {
    if (
      revision.document.kartId !== revision.kartId ||
      revision.resolvedSnapshot.kartId !== revision.kartId
    ) {
      context.addIssue({
        code: "custom",
        message: "Published kart identity is inconsistent.",
      });
    }
  });

export type KartPublicationEvent = z.infer<
  typeof kartPublicationEventSchema
>;
export type PersistedKartRevision = z.infer<
  typeof persistedKartRevisionSchema
>;
