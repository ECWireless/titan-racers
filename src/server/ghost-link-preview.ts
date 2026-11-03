import { FALLS_VIEW_PARK_COURSE_ID } from "@/game/course/course-ids";
import { exactRacerUsernameSchema } from "@/lib/racer-username";
import { loadRacerStanding } from "@/server/leaderboard";

// A preview that waits longer than this goes out plain rather than late.
const LOOKUP_TIMEOUT_MS = 2_000;

/**
 * The standing a ghost link's preview shows, looked up by its exact
 * username. Null for any other text, a racer with no best, or a lookup
 * that fails or hangs: a preview never fails, it falls back to the plain one.
 */
export async function findGhostLinkStanding(racer: unknown) {
  const username = exactRacerUsernameSchema.safeParse(
    typeof racer === "string" ? racer : "",
  );
  if (!username.success) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadRacerStanding(FALLS_VIEW_PARK_COURSE_ID, username.data),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
