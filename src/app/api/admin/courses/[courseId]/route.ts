import { z } from "zod";

import {
  courseIdSchema,
  parseCourseDocument,
} from "@/game/course/course-document";
import {
  authorizationErrorResponse,
  authorizeRole,
} from "@/server/authorization";
import {
  CourseConflictError,
  loadLatestCoursePublication,
  loadLatestCourseRevision,
  saveCourseRevision,
} from "@/server/course-repository";
import { protectedJsonMutationError } from "@/server/request-guards";

const saveRequestSchema = z.strictObject({
  document: z.unknown(),
  expectedRevision: z.number().int().nonnegative().nullable(),
});

type RouteContext = { params: Promise<{ courseId: string }> };

function publicationSummary(
  publication: Awaited<ReturnType<typeof loadLatestCoursePublication>>,
) {
  return publication
    ? {
        publicationId: publication.publicationId,
        publishedAt: publication.publishedAt,
        publishedByUserId: publication.publishedByUserId,
        revision: publication.revision,
      }
    : null;
}

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");

  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }

  const { courseId } = await context.params;
  if (!courseIdSchema.safeParse(courseId).success) {
    return Response.json({ error: "Invalid course ID." }, { status: 400 });
  }
  const [revision, publication] = await Promise.all([
    loadLatestCourseRevision(courseId),
    loadLatestCoursePublication(courseId),
  ]);

  if (!revision) {
    return Response.json({ error: "Course not found." }, { status: 404 });
  }

  return Response.json({
    ...revision,
    publication: publicationSummary(publication),
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");

  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) {
    return mutationError;
  }

  let payload: z.infer<typeof saveRequestSchema>;

  try {
    payload = saveRequestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json({ error: "Invalid course save request." }, { status: 400 });
    }

    throw error;
  }

  const { courseId } = await context.params;
  if (!courseIdSchema.safeParse(courseId).success) {
    return Response.json({ error: "Invalid course ID." }, { status: 400 });
  }

  try {
    const document = parseCourseDocument(payload.document);

    if (document.courseId !== courseId) {
      return Response.json(
        { error: "Route and document course IDs must match." },
        { status: 400 },
      );
    }

    const revision = await saveCourseRevision({
      authorUserId: authorization.userId,
      document,
      expectedRevision: payload.expectedRevision,
    });
    const publication = await loadLatestCoursePublication(courseId);

    return Response.json({ ...revision, publication: publicationSummary(publication) }, {
      status: payload.expectedRevision === null ? 201 : 200,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Course document validation failed.", issues: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof CourseConflictError) {
      return Response.json(
        { error: error.message },
        { status: 409 },
      );
    }

    throw error;
  }
}
