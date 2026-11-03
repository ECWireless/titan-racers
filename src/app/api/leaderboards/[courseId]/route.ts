import { LEADERBOARD_COURSE_IDS } from "@/game/course/course-ids";
import { loadLeaderboard } from "@/server/leaderboard";
import { sessionUserIdOrResponse } from "@/server/session-user";

type RouteContext = { params: Promise<{ courseId: string }> };

/**
 * The course's current board, or with `?board=<number>` an earlier one, with
 * the viewer's own standing if any.
 */
export async function GET(request: Request, context: RouteContext) {
  const { courseId } = await context.params;
  if (!(LEADERBOARD_COURSE_IDS as readonly string[]).includes(courseId)) {
    return Response.json({ error: "No leaderboard." }, { status: 404 });
  }
  const requested = new URL(request.url).searchParams.get("board");
  const boardNumber = requested === null ? null : Number(requested);
  if (
    boardNumber !== null &&
    !(Number.isInteger(boardNumber) && boardNumber > 0 && boardNumber < 2 ** 31)
  ) {
    return Response.json({ error: "Invalid leaderboard." }, { status: 400 });
  }
  const leaderboard = await loadLeaderboard(
    courseId,
    // Anyone may look; a signed-in viewer also sees their own standing.
    await sessionUserIdOrResponse(request).then((viewer) =>
      typeof viewer === "string" ? viewer : null,
    ),
    boardNumber,
  );
  return leaderboard
    ? Response.json(leaderboard, { headers: { "cache-control": "no-store" } })
    : Response.json(
        { error: "No such leaderboard." },
        { headers: { "cache-control": "no-store" }, status: 404 },
      );
}
