import { loadScoreBoard } from "@/server/scores";
import { sessionUserIdOrResponse } from "@/server/session-user";

const NO_STORE = { "cache-control": "no-store" };

/**
 * The score board: every racer with a score, the official karts' royalties,
 * and, for a signed-in viewer, their own score.
 */
export async function GET(request: Request) {
  // Anyone may look; a signed-in viewer also sees their own score.
  const viewer = await sessionUserIdOrResponse(request).then((user) =>
    typeof user === "string" ? user : null,
  );
  return Response.json(await loadScoreBoard(viewer), { headers: NO_STORE });
}
