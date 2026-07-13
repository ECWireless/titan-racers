import { courseIdSchema } from "@/game/course/course-document";
import { loadLatestCoursePublication } from "@/server/course-repository";

type RouteContext = { params: Promise<{ courseId: string }> };
const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(_request: Request, context: RouteContext) {
  const { courseId } = await context.params;
  if (!courseIdSchema.safeParse(courseId).success) {
    return Response.json(
      { error: "Invalid course ID." },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }

  const publication = await loadLatestCoursePublication(courseId);
  if (!publication) {
    return Response.json(
      { error: "Published course not found." },
      { headers: NO_STORE_HEADERS, status: 404 },
    );
  }

  return Response.json({
    courseId: publication.courseId,
    document: publication.document,
    publishedAt: publication.publishedAt,
    revision: publication.revision,
    schemaVersion: publication.schemaVersion,
  }, {
    headers: NO_STORE_HEADERS,
  });
}
