import { kartStableIdSchema } from "@/game/kart/kart-assembly-document";
import {
  authorizationErrorResponse,
  authorizeRole,
} from "@/server/authorization";
import {
  KartThumbnailConflictError,
  KartThumbnailTargetError,
  loadKartRevisionThumbnail,
  saveKartRevisionThumbnail,
} from "@/server/kart-repository";
import {
  KartThumbnailValidationError,
  kartThumbnailResponse,
  parseKartThumbnailUpload,
} from "@/server/kart-thumbnail";
import { protectedJsonMutationError } from "@/server/request-guards";

type RouteContext = {
  params: Promise<{ kartId: string; revision: string }>;
};
const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");
  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }
  const target = await parseTarget(context);
  if (target instanceof Response) return target;
  const thumbnail = await loadKartRevisionThumbnail(
    target.kartId,
    target.revision,
  );
  if (!thumbnail) {
    return Response.json(
      { error: "Kart thumbnail not found." },
      { headers: NO_STORE_HEADERS, status: 404 },
    );
  }
  return kartThumbnailResponse(thumbnail);
}

export async function PUT(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");
  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  const target = await parseTarget(context);
  if (target instanceof Response) return target;

  try {
    const upload = parseKartThumbnailUpload(await request.json());
    const thumbnail = await saveKartRevisionThumbnail({
      ...target,
      ...upload,
      generatedByUserId: authorization.userId,
    });
    return Response.json(
      {
        createdAt: thumbnail.createdAt,
        imageSha256: thumbnail.imageSha256,
        renderVersion: thumbnail.renderVersion,
      },
      { headers: NO_STORE_HEADERS, status: 201 },
    );
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      error instanceof KartThumbnailValidationError
    ) {
      return Response.json(
        { error: "Invalid kart thumbnail request." },
        { headers: NO_STORE_HEADERS, status: 400 },
      );
    }
    if (error instanceof KartThumbnailConflictError) {
      return Response.json(
        { error: error.message },
        { headers: NO_STORE_HEADERS, status: 409 },
      );
    }
    if (error instanceof KartThumbnailTargetError) {
      return Response.json(
        { error: error.message },
        { headers: NO_STORE_HEADERS, status: 404 },
      );
    }
    throw error;
  }
}

async function parseTarget(context: RouteContext) {
  const { kartId, revision: rawRevision } = await context.params;
  const revision = Number(rawRevision);
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
  return { kartId, revision };
}
