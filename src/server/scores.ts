import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { LEADERBOARD_COURSE_IDS } from "@/game/course/course-ids";
import { OFFICIAL_KART_IDS } from "@/game/kart/official-kart-roster";
import { CURRENT_PHYSICS_VERSION } from "@/game/physics/physics-version";
import {
  pointsForPlace,
  SCORING_PLACES,
  type ScoreBoard,
  splitPoints,
} from "@/game/race/scores";
import { loadLatestPublishedRevision } from "@/server/course-repository";
import { findLeaderboard } from "@/server/race-results";

/**
 * Scores, worked out on each read from the live standings: the top 20 on
 * each course's current board earn their place's points, 90% to the racer
 * and 10% to the kart's assembler. Official karts' share goes to Titan
 * Racers, which has no account, so it counts only as the kart's royalties.
 * Tests pass their own IDs.
 */
export async function loadScoreBoard(
  viewerUserId: string | null,
  {
    courseIds = LEADERBOARD_COURSE_IDS,
    kartIds = OFFICIAL_KART_IDS,
  }: { courseIds?: readonly string[]; kartIds?: readonly string[] } = {},
): Promise<ScoreBoard> {
  const courses = (
    await Promise.all(
      courseIds.map(async (courseId) => {
        const published = await loadLatestPublishedRevision(courseId);
        if (!published) return null;
        // Null before the current board's first run: it scores nothing yet.
        const leaderboardId = await findLeaderboard(db, {
          courseId,
          courseRevision: published.revision,
          physicsVersion: CURRENT_PHYSICS_VERSION,
        });
        return { courseId, courseName: published.courseName, leaderboardId };
      }),
    )
  ).filter((course) => course !== null);
  const boardIds = courses.flatMap(({ leaderboardId }) =>
    leaderboardId === null ? [] : [leaderboardId],
  );

  // Each board's top 20, in the leaderboard's own order: time, then who
  // set it first, then racer.
  const { rows } = boardIds.length
    ? await db.execute<{
        kart_id: string;
        place: string;
        user_id: string;
        username: string | null;
      }>(sql`
        select ranked.place, ranked.user_id, users.username, result.kart_id
        from (
          select best.user_id, best.result_id,
            row_number() over (
              partition by best.leaderboard_id
              order by best.time_microseconds, best.achieved_at, best.user_id
            ) as place
          from board_bests best
          where best.leaderboard_id in (${sql.join(
            boardIds.map((id) => sql`${id}`),
            sql`, `,
          )})
        ) ranked
        join race_results result on result.id = ranked.result_id
        join users on users.id = ranked.user_id
        where ranked.place <= ${SCORING_PLACES}
      `)
    : { rows: [] };

  const racers = new Map<string, { score: number; username: string | null }>();
  const royalties = new Map<string, number>(kartIds.map((id) => [id, 0]));
  for (const row of rows) {
    const { assembler, racer } = splitPoints(pointsForPlace(Number(row.place)));
    const current = racers.get(row.user_id);
    racers.set(row.user_id, {
      score: (current?.score ?? 0) + racer,
      username: row.username,
    });
    if (royalties.has(row.kart_id)) {
      royalties.set(row.kart_id, royalties.get(row.kart_id)! + assembler);
    }
  }

  // Equal scores share a rank, listed by username.
  const ranked = [...racers]
    .flatMap(([userId, { score, username }]) =>
      username === null ? [] : [{ score, userId, username }],
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.username < right.username ? -1 : 1),
    );
  const entries = ranked.map((entry) => ({
    rank: 1 + ranked.filter(({ score }) => score > entry.score).length,
    score: entry.score,
    username: entry.username,
    viewer: entry.userId === viewerUserId,
  }));
  const viewerEntry = entries.find(({ viewer }) => viewer);

  return {
    courses: courses.map(({ courseId, courseName }) => ({
      courseId,
      courseName,
    })),
    entries,
    karts: [...royalties].map(([kartId, earned]) => ({
      kartId,
      royalties: earned,
    })),
    viewer:
      viewerUserId === null
        ? null
        : {
            rank: viewerEntry?.rank ?? null,
            score: viewerEntry?.score ?? 0,
          },
  };
}
