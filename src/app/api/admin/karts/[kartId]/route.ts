import { z } from "zod";

import {
  kartStableIdSchema,
  parseKartAssemblyDocument,
} from "@/game/kart/kart-assembly-document";
import { KartAssemblyValidationError } from "@/game/kart/kart-assembly-validation";
import {
  authorizationErrorResponse,
  authorizeRole,
} from "@/server/authorization";
import {
  KartConflictError,
  loadLatestKartPublicationEvent,
  loadLatestKartRevision,
  saveKartRevision,
} from "@/server/kart-repository";
import { protectedJsonMutationError } from "@/server/request-guards";

const saveRequestSchema = z.strictObject({
  document: z.unknown(),
  expectedRevision: z.number().int().positive().nullable(),
});

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

  const [revision, publication] = await Promise.all([
    loadLatestKartRevision(kartId),
    loadLatestKartPublicationEvent(kartId),
  ]);
  if (!revision) {
    return Response.json({ error: "Kart not found." }, { status: 404 });
  }

  return Response.json({ ...revision, publication });
}

export async function PUT(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");
  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;

  let payload: z.infer<typeof saveRequestSchema>;
  try {
    payload = saveRequestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid kart save request." },
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
    const document = parseKartAssemblyDocument(payload.document);
    if (document.kartId !== kartId) {
      return Response.json(
        { error: "Route and document kart IDs must match." },
        { status: 400 },
      );
    }

    const revision = await saveKartRevision({
      authorUserId: authorization.userId,
      document,
      expectedRevision: payload.expectedRevision,
      ownerUserId: authorization.userId,
    });
    const publication = await loadLatestKartPublicationEvent(kartId);

    return Response.json(
      { ...revision, publication },
      { status: payload.expectedRevision === null ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Kart document schema validation failed.", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof KartAssemblyValidationError) {
      return Response.json(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof KartConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
