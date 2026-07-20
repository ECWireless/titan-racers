import { kartStableIdSchema } from "@/game/kart/kart-assembly-document";
import { loadPublishedKartRevision } from "@/server/kart-repository";

type RouteContext = { params: Promise<{ kartId: string }> };
const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(_request: Request, context: RouteContext) {
  const { kartId } = await context.params;
  if (!kartStableIdSchema.safeParse(kartId).success) {
    return Response.json(
      { error: "Invalid kart ID." },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }

  const published = await loadPublishedKartRevision(kartId);
  if (!published) {
    return Response.json(
      { error: "Published kart not found." },
      { headers: NO_STORE_HEADERS, status: 404 },
    );
  }

  return Response.json(
    {
      derivationVersion: published.derivationVersion,
      document: published.document,
      kartId: published.kartId,
      publishedAt: published.publication.occurredAt,
      resolvedSnapshot: published.resolvedSnapshot,
      resolvedSnapshotHash: published.resolvedSnapshotHash,
      revision: published.revision,
      schemaVersion: published.schemaVersion,
    },
    { headers: NO_STORE_HEADERS },
  );
}
