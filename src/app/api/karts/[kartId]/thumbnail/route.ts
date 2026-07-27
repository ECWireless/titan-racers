import { kartStableIdSchema } from "@/game/kart/kart-assembly-document";
import {
  loadKartRevisionThumbnail,
  loadPublishedKartRevision,
} from "@/server/kart-repository";
import { kartThumbnailResponse } from "@/server/kart-thumbnail";

type RouteContext = { params: Promise<{ kartId: string }> };
const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(request: Request, context: RouteContext) {
  const { kartId } = await context.params;
  const revision = Number(new URL(request.url).searchParams.get("revision"));
  if (
    !kartStableIdSchema.safeParse(kartId).success ||
    !Number.isSafeInteger(revision) ||
    revision <= 0
  ) {
    return Response.json(
      { error: "Invalid kart thumbnail target." },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }
  const published = await loadPublishedKartRevision(kartId);
  if (!published || published.revision !== revision) {
    return Response.json(
      { error: "Published kart revision not found." },
      { headers: NO_STORE_HEADERS, status: 404 },
    );
  }
  const thumbnail = await loadKartRevisionThumbnail(kartId, revision);
  if (!thumbnail) {
    return Response.json(
      { error: "Published kart thumbnail not found." },
      { headers: NO_STORE_HEADERS, status: 404 },
    );
  }
  return kartThumbnailResponse(thumbnail);
}
