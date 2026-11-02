import { LEADERBOARD_COURSE_IDS } from "../course/course-ids";
import {
  type BoardGhost,
  type GhostChoice,
  parseGhostRecord,
} from "./device-ghost";

/**
 * The ghost a solo race takes from the board: the course best, or your
 * account best if you chose your own. Null (an empty board, a guest, a
 * failed request, or a race without a board) leaves your best on this
 * device. An empty board has no account best either, so there is nothing
 * else to ask for.
 */
export async function fetchRaceGhost(
  courseId: string,
  courseRevision: number | null,
  choice: GhostChoice,
): Promise<BoardGhost | null> {
  if (
    courseRevision === null ||
    !(LEADERBOARD_COURSE_IDS as readonly string[]).includes(courseId)
  ) {
    return null;
  }
  const best = choice === "course_best" ? "course" : "mine";
  try {
    const response = await fetch(
      `/api/leaderboards/${courseId}/ghost?best=${best}&revision=${courseRevision}`,
      { cache: "no-store", signal: AbortSignal.timeout(3_000) },
    );
    if (!response.ok) return null;
    const { ghost } = (await response.json()) as { ghost: unknown };
    const parsed = ghost
      ? parseGhostRecord(ghost, courseId, courseRevision)
      : null;
    return parsed ? { ghost: parsed, kind: choice } : null;
  } catch {
    return null;
  }
}
