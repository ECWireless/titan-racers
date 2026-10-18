import {
  createBundledOfficialKartRoster,
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

function publicAssemblerCredit(authorUsername: string | null) {
  const trimmed = authorUsername?.trim();
  return trimmed
    ? `@${trimmed}`.slice(0, 80)
    : OFFICIAL_KART_FALLBACK_ASSEMBLER_CREDIT;
}

export async function loadOfficialKartRoster(
  loadPublished: OfficialKartPublicationLoader = loadPublishedKartRevision,
): Promise<OfficialKartRoster> {
  const results = await Promise.allSettled(
    OFFICIAL_KART_IDS.map((kartId) => loadPublished(kartId)),
  );
  // Every load failing is the practical "database unreachable" signal.
  if (results.every(({ status }) => status === "rejected")) {
    return createBundledOfficialKartRoster();
  }
  const published = results.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return result.value ? [result.value] : [];
    }
    const message =
      result.reason instanceof Error ? result.reason.message : "Unknown error";
    console.error(
      `Dropping official kart ${OFFICIAL_KART_IDS[index]}: ${message}`,
    );
    return [];
  });
  try {
    return officialKartRosterSchema.parse({
      karts: published.map((revision) => ({
        assemblerCredit: publicAssemblerCredit(revision.authorUsername),
        runtime: {
          derivationVersion: revision.derivationVersion,
          document: revision.document,
          kartId: revision.kartId,
          publishedAt: revision.publication.occurredAt.toISOString(),
          resolvedSnapshot: revision.resolvedSnapshot,
          resolvedSnapshotHash: revision.resolvedSnapshotHash,
          revision: revision.revision,
          schemaVersion: revision.schemaVersion,
          thumbnailAvailable: revision.thumbnailAvailable,
        },
      })),
      source: "published",
    });
  } catch {
    return createBundledOfficialKartRoster();
  }
}
