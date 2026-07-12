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
  loadLatestCourseRevision,
  saveCourseRevision,
} from "@/server/course-repository";

const saveRequestSchema = z.strictObject({
  document: z.unknown(),
  expectedRevision: z.number().int().nonnegative().nullable(),
});

type RouteContext = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");

  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }

  const { courseId } = await context.params;
  if (!courseIdSchema.safeParse(courseId).success) {
    return Response.json({ error: "Invalid course ID." }, { status: 400 });
  }
  const revision = await loadLatestCourseRevision(courseId);

  if (!revision) {
    return Response.json({ error: "Course not found." }, { status: 404 });
  }

  return Response.json(revision);
}

export async function PUT(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");

  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
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

    return Response.json(revision, {
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
