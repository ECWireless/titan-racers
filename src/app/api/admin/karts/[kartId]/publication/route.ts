import { z } from "zod";

import { kartStableIdSchema } from "@/game/kart/kart-assembly-document";
import {
  authorizationErrorResponse,
  authorizeRole,
} from "@/server/authorization";
import {
  KartPublicationConflictError,
  KartPublicationTargetError,
  loadLatestKartPublicationEvent,
  publishKartRevision,
  unpublishKart,
} from "@/server/kart-repository";
import { protectedJsonMutationError } from "@/server/request-guards";

const publicationRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("publish"),
    expectedPublicationEventId: z.number().int().positive().nullable(),
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("unpublish"),
    expectedPublicationEventId: z.number().int().positive().nullable(),
  }),
]);

type RouteContext = { params: Promise<{ kartId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");
  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }

  const { kartId } = await context.params;
  if (!kartStableIdSchema.safeParse(kartId).success) {
    return Response.json({ error: "Invalid kart ID." }, { status: 400 });
  }

  return Response.json({
    publication: await loadLatestKartPublicationEvent(kartId),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");
  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;

  let payload: z.infer<typeof publicationRequestSchema>;
  try {
    payload = publicationRequestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid kart publication request." },
        { status: 400 },
      );
    }
    throw error;
  }

  const { kartId } = await context.params;
  if (!kartStableIdSchema.safeParse(kartId).success) {
    return Response.json({ error: "Invalid kart ID." }, { status: 400 });
  }

  try {
    const publication =
      payload.action === "publish"
        ? await publishKartRevision({
            actorUserId: authorization.userId,
            expectedPublicationEventId: payload.expectedPublicationEventId,
            kartId,
            revision: payload.revision,
          })
        : await unpublishKart({
            actorUserId: authorization.userId,
            expectedPublicationEventId: payload.expectedPublicationEventId,
            kartId,
          });
    return Response.json(publication, { status: 201 });
  } catch (error) {
    if (error instanceof KartPublicationConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof KartPublicationTargetError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
