import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { CURRENT_PHYSICS_VERSION } from "@/game/physics/physics-version";
import type { LeaderboardResponse } from "@/game/race/leaderboard";
import { loadLatestPublishedRevision } from "@/server/course-repository";
import { findLeaderboard, racerStanding } from "@/server/race-results";

const BOARD_SIZE = 50;

/**
 * A course's current board: its newest published revision under the current
 * physics, with the viewer's own standing.
 */
export async function loadLeaderboard(
  courseId: string,
  viewerUserId: string | null,
): Promise<LeaderboardResponse> {
  const published = await loadLatestPublishedRevision(courseId);
  if (!published) return { board: null };

  const leaderboardId = await findLeaderboard(db, {
    courseId,
    courseRevision: published.revision,
    physicsVersion: CURRENT_PHYSICS_VERSION,
  });
  if (leaderboardId === null) {
    return {
      board: { courseName: published.courseName, entries: [], viewer: null },
    };
  }

  const { rows } = await db.execute<{
    kart_name: string;
    time_microseconds: number;
    user_id: string;
    username: string;
  }>(sql`
    select
      users.username,
      best.user_id,
      best.time_microseconds,
      coalesce(kart.document ->> 'name', result.kart_id) as kart_name
    from board_bests best
    join users on users.id = best.user_id
    join race_results result on result.id = best.result_id
    left join kart_revisions kart
      on kart.kart_id = result.kart_id and kart.revision = result.kart_revision
    where best.leaderboard_id = ${leaderboardId}
    order by best.time_microseconds, best.achieved_at, best.user_id
    limit ${BOARD_SIZE}
  `);
  const standing = viewerUserId
    ? await racerStanding(db, leaderboardId, viewerUserId)
    : null;

  return {
    board: {
      courseName: published.courseName,
      entries: rows.map((row, index) => ({
        kartName: row.kart_name,
        rank: index + 1,
        timeMicroseconds: row.time_microseconds,
        username: row.username,
        viewer: row.user_id === viewerUserId,
      })),
      viewer: standing
        ? { rank: standing.rank, timeMicroseconds: standing.best }
        : null,
    },
  };
}
