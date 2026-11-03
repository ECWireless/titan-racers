import { z } from "zod";

import { courseIdSchema } from "@/game/course/course-document";
import { LEADERBOARD_COURSE_IDS } from "@/game/course/course-ids";
import {
  authorizationErrorResponse,
  authorizeRole,
} from "@/server/authorization";
import {
  CoursePublicationConflictError,
  CoursePublicationOrderError,
  CoursePublicationTargetError,
  loadLatestCoursePublication,
  publishCourseRevision,
} from "@/server/course-repository";
import { loadCurrentBoardSummary } from "@/server/leaderboard";
import { protectedJsonMutationError } from "@/server/request-guards";

const publishRequestSchema = z.strictObject({
  expectedPublicationId: z.number().int().positive().nullable(),
  // Off keeps the course's leaderboard.
  newLeaderboard: z.boolean().default(false),
  revision: z.number().int().positive(),
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

  const [publication, leaderboard] = await Promise.all([
    loadLatestCoursePublication(courseId),
    // The board a publication would keep or close.
    (LEADERBOARD_COURSE_IDS as readonly string[]).includes(courseId)
      ? loadCurrentBoardSummary(courseId)
      : null,
  ]);
  return Response.json(
    { leaderboard, publication },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const authorization = await authorizeRole(request, "admin");
  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) {
    return mutationError;
  }

  let payload: z.infer<typeof publishRequestSchema>;
  try {
    payload = publishRequestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid course publication request." },
        { status: 400 },
      );
    }
    throw error;
  }

  const { courseId } = await context.params;
  if (!courseIdSchema.safeParse(courseId).success) {
    return Response.json({ error: "Invalid course ID." }, { status: 400 });
  }

  try {
    const publication = await publishCourseRevision({
      courseId,
      expectedPublicationId: payload.expectedPublicationId,
      newLeaderboard: payload.newLeaderboard,
      publishedByUserId: authorization.userId,
      revision: payload.revision,
    });
    return Response.json(publication, { status: 201 });
  } catch (error) {
    if (
      error instanceof CoursePublicationConflictError ||
      error instanceof CoursePublicationOrderError
    ) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof CoursePublicationTargetError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
