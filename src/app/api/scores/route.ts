import { loadScoreBoard } from "@/server/scores";
import { sessionUserIdOrResponse } from "@/server/session-user";

const NO_STORE = { "cache-control": "no-store" };

/**
 * The score board: every racer with a score and, for a signed-in viewer,
 * their own score. What karts earn their assemblers is not shown.
 */
export async function GET(request: Request) {
  // Anyone may look; a signed-in viewer also sees their own score.
  const viewer = await sessionUserIdOrResponse(request).then((user) =>
    typeof user === "string" ? user : null,
  );
  const { courses, entries, viewer: own } = await loadScoreBoard(viewer);
  return Response.json({ courses, entries, viewer: own }, { headers: NO_STORE });
}
