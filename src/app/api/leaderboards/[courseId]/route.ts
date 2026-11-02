import { LEADERBOARD_COURSE_IDS } from "@/game/course/course-ids";
import { loadLeaderboard } from "@/server/leaderboard";
import { sessionUserIdOrResponse } from "@/server/session-user";

type RouteContext = { params: Promise<{ courseId: string }> };

/** The course's current board, with the viewer's own standing if any. */
export async function GET(request: Request, context: RouteContext) {
  const { courseId } = await context.params;
  if (!(LEADERBOARD_COURSE_IDS as readonly string[]).includes(courseId)) {
    return Response.json({ error: "No leaderboard." }, { status: 404 });
  }
  return Response.json(
    await loadLeaderboard(
      courseId,
      // Anyone may look; a signed-in viewer also sees their own standing.
      await sessionUserIdOrResponse(request).then((viewer) =>
        typeof viewer === "string" ? viewer : null,
      ),
    ),
    { headers: { "cache-control": "no-store" } },
  );
}
