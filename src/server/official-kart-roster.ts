import { deriveKartSnapshot } from "@/game/kart/kart-derivation";
import {
  createOfficialKartRosterDocuments,
  OFFICIAL_KART_FALLBACK_ASSEMBLER_CREDIT,
  OFFICIAL_KART_IDS,
  officialKartRosterSchema,
  type OfficialKartId,
  type OfficialKartRoster,
} from "@/game/kart/official-kart-roster";
import {
  loadPublishedKartRevision,
  type PersistedPublishedKartRevision,
} from "@/server/kart-repository";

export type OfficialKartPublicationLoader = (
  kartId: OfficialKartId,
) => Promise<PersistedPublishedKartRevision | null>;

function publicAssemblerCredit(authorName: string) {
  const trimmed = authorName.trim();
  return trimmed
    ? trimmed.slice(0, 80)
    : OFFICIAL_KART_FALLBACK_ASSEMBLER_CREDIT;
}

function createBundledFallbackRoster(): OfficialKartRoster {
  return officialKartRosterSchema.parse({
    karts: createOfficialKartRosterDocuments().map((document) => ({
      assemblerCredit: OFFICIAL_KART_FALLBACK_ASSEMBLER_CREDIT,
      document,
      kartId: document.kartId,
      resolvedSnapshot: deriveKartSnapshot(document),
    })),
    source: "bundled-fallback",
  });
}

export async function loadOfficialKartRoster(
  loadPublished: OfficialKartPublicationLoader = loadPublishedKartRevision,
): Promise<OfficialKartRoster> {
  try {
    const published = await Promise.all(
      OFFICIAL_KART_IDS.map((kartId) => loadPublished(kartId)),
    );
    return officialKartRosterSchema.parse({
      karts: published
        .filter(
          (
            revision,
          ): revision is PersistedPublishedKartRevision => revision !== null,
        )
        .map((revision) => ({
          assemblerCredit: publicAssemblerCredit(revision.authorName),
          runtime: {
            derivationVersion: revision.derivationVersion,
            document: revision.document,
            kartId: revision.kartId,
            publishedAt: revision.publication.occurredAt.toISOString(),
            resolvedSnapshot: revision.resolvedSnapshot,
            resolvedSnapshotHash: revision.resolvedSnapshotHash,
            revision: revision.revision,
            schemaVersion: revision.schemaVersion,
          },
        })),
      source: "published",
    });
  } catch {
    return createBundledFallbackRoster();
  }
}
