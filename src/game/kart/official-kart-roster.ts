import { z } from "zod";

import {
  BALANCED_KART_ID,
  createBalancedKartDocument,
} from "./balanced-kart-document";
import {
  createHandlingKartDocument,
  HANDLING_KART_ID,
} from "./handling-kart-document";
import {
  kartAssemblyDocumentSchema,
  type KartAssemblyDocument,
} from "./kart-assembly-document";
import { resolvedKartSnapshotV2Schema } from "./kart-derivation";
import { publishedKartRuntimeSchema } from "./kart-publication";
import {
  createSpeedKartDocument,
  SPEED_KART_ID,
} from "./speed-kart-document";

export const OFFICIAL_KART_IDS = Object.freeze([
  BALANCED_KART_ID,
  SPEED_KART_ID,
  HANDLING_KART_ID,
] as const);

export type OfficialKartId = (typeof OFFICIAL_KART_IDS)[number];

export const OFFICIAL_KART_FALLBACK_ASSEMBLER_CREDIT = "Titan Racers";

const assemblerCreditSchema = z.string().trim().min(1).max(80);
const persistedOfficialKartRosterEntrySchema = z.strictObject({
  assemblerCredit: assemblerCreditSchema,
  runtime: publishedKartRuntimeSchema,
});
const bundledOfficialKartRosterEntrySchema = z
  .strictObject({
    assemblerCredit: assemblerCreditSchema,
    document: kartAssemblyDocumentSchema,
    kartId: z.enum(OFFICIAL_KART_IDS),
    resolvedSnapshot: resolvedKartSnapshotV2Schema,
  })
  .superRefine((entry, context) => {
    if (
      entry.document.kartId !== entry.kartId ||
      entry.resolvedSnapshot.kartId !== entry.kartId
    ) {
      context.addIssue({
        code: "custom",
        message: "Bundled official kart identity is inconsistent.",
      });
    }
  });

export const officialKartRosterSchema = z
  .discriminatedUnion("source", [
    z.strictObject({
      karts: z.array(persistedOfficialKartRosterEntrySchema).max(3),
      source: z.literal("published"),
    }),
    z.strictObject({
      karts: z.array(bundledOfficialKartRosterEntrySchema).length(3),
      source: z.literal("bundled-fallback"),
    }),
  ])
  .superRefine((roster, context) => {
    const kartIds = roster.karts.map((entry) =>
      "runtime" in entry ? entry.runtime.kartId : entry.kartId,
    );
    if (
      kartIds.some(
        (kartId) => !OFFICIAL_KART_IDS.includes(kartId as OfficialKartId),
      ) ||
      new Set(kartIds).size !== kartIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Official kart roster identities must be known and unique.",
      });
    }
    if (
      roster.source === "bundled-fallback" &&
      kartIds.some((kartId, index) => kartId !== OFFICIAL_KART_IDS[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Bundled official kart roster order is inconsistent.",
      });
    }
  });

export type OfficialKartRoster = z.infer<typeof officialKartRosterSchema>;

const OFFICIAL_KART_DOCUMENT_FACTORIES = {
  [BALANCED_KART_ID]: createBalancedKartDocument,
  [HANDLING_KART_ID]: createHandlingKartDocument,
  [SPEED_KART_ID]: createSpeedKartDocument,
} satisfies Record<OfficialKartId, () => KartAssemblyDocument>;

export function createOfficialKartDocument(
  kartId: OfficialKartId,
): KartAssemblyDocument {
  return OFFICIAL_KART_DOCUMENT_FACTORIES[kartId]();
}

/**
 * Returns a fresh bundled assembly for each official roster entry. Persistence
 * and publication decide which revisions are player-visible.
 */
export function createOfficialKartRosterDocuments(): KartAssemblyDocument[] {
  return OFFICIAL_KART_IDS.map(createOfficialKartDocument);
}
