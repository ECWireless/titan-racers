import { z } from "zod";

import { LEADERBOARD_COURSE_IDS } from "@/game/course/course-ids";
import { loadBoardGhost } from "@/server/leaderboard";
import { sessionUserIdOrResponse } from "@/server/session-user";

type RouteContext = { params: Promise<{ courseId: string }> };
const NO_STORE_HEADERS = { "cache-control": "no-store" };

const ghostQuerySchema = z.strictObject({
  best: z.enum(["course", "mine"]),
  revision: z.coerce.number().int().positive().max(2_147_483_647),
});

/**
 * A board's course best for anyone, or the signed-in racer's own best, as a
 * ghost to race. No ghost (or no session, for your own) is a null ghost.
 */
export async function GET(request: Request, context: RouteContext) {
  const { courseId } = await context.params;
  if (!(LEADERBOARD_COURSE_IDS as readonly string[]).includes(courseId)) {
    return Response.json({ error: "No leaderboard." }, { status: 404 });
  }
  const query = ghostQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return Response.json({ error: "Invalid ghost request." }, { status: 400 });
  }

  let userId: string | null = null;
  if (query.data.best === "mine") {
    const viewer = await sessionUserIdOrResponse(request);
    if (typeof viewer !== "string") {
      return Response.json({ ghost: null }, { headers: NO_STORE_HEADERS });
    }
    userId = viewer;
  }
  return Response.json(
    { ghost: await loadBoardGhost(courseId, query.data.revision, userId) },
    { headers: NO_STORE_HEADERS },
  );
}
