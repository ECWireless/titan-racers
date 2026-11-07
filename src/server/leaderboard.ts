import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { CURRENT_PHYSICS_VERSION } from "@/game/physics/physics-version";
import { parseKartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import { parseResolvedKartSnapshot } from "@/game/kart/kart-derivation";
import type { LeaderboardResponse } from "@/game/race/leaderboard";
import { loadLatestPublishedRevision } from "@/server/course-repository";
import {
  findLeaderboard,
  isOnCurrentBoard,
  listEarlierLeaderboards,
  racerStanding,
} from "@/server/race-results";

const BOARD_SIZE = 50;

/**
 * A course's current board (its newest published revision under the current
 * physics), or an earlier one by its number, with the viewer's own standing
 * and the earlier boards there are to look back on. Null for a number that
 * names no earlier board with times.
 */
export async function loadLeaderboard(
  courseId: string,
  viewerUserId: string | null,
  boardNumber: number | null = null,
): Promise<LeaderboardResponse | null> {
  const published = await loadLatestPublishedRevision(courseId);
  if (!published) return boardNumber === null ? { board: null, earlier: [] } : null;

  const race = {
    courseId,
    courseRevision: published.revision,
    physicsVersion: CURRENT_PHYSICS_VERSION,
  };
  const [currentId, earlierBoards] = await Promise.all([
    findLeaderboard(db, race),
    listEarlierLeaderboards(db, race),
  ]);
  const earlier = earlierBoards.map(({ firstTimeAt, lastTimeAt, number }) => ({
    firstTimeAt: firstTimeAt.toISOString(),
    lastTimeAt: lastTimeAt.toISOString(),
    number,
  }));
  const leaderboardId =
    boardNumber === null
      ? currentId
      : (earlierBoards.find(({ number }) => number === boardNumber)?.id ??
        undefined);
  if (leaderboardId === undefined) return null;
  if (leaderboardId === null) {
    return {
      board: {
        courseName: published.courseName,
        entries: [],
        lapEntries: [],
        viewer: null,
      },
      earlier,
    };
  }

  // Each racer's best race, its kart, and its fastest lap, ranked by time
  // and by lap, each tie going to the race set first.
  const { rows } = await db.execute<{
    fastest_lap_microseconds: number | null;
    kart_name: string;
    lap_rank: string | null;
    time_microseconds: number;
    time_rank: string;
    user_id: string;
    username: string;
  }>(sql`
    with ranked as (
      select best.user_id, best.time_microseconds,
        result.fastest_lap_microseconds, result.kart_id, result.kart_revision,
        row_number() over (
          order by best.time_microseconds, best.achieved_at, best.user_id
        ) as time_rank,
        case when result.fastest_lap_microseconds is not null then
          row_number() over (
            order by result.fastest_lap_microseconds nulls last,
              best.achieved_at, best.user_id
          )
        end as lap_rank
      from board_bests best
      join race_results result on result.id = best.result_id
      where best.leaderboard_id = ${leaderboardId}
    )
    select users.username, ranked.user_id, ranked.time_microseconds,
      ranked.fastest_lap_microseconds, ranked.time_rank, ranked.lap_rank,
      coalesce(kart.document ->> 'name', ranked.kart_id) as kart_name
    from ranked
    join users on users.id = ranked.user_id
    left join kart_revisions kart
      on kart.kart_id = ranked.kart_id and kart.revision = ranked.kart_revision
    where ranked.time_rank <= ${BOARD_SIZE}
      or ranked.lap_rank <= ${BOARD_SIZE}
      or ranked.user_id = ${viewerUserId}
  `);
  const racers = rows.map((row) => ({
    ...row,
    lapRank: row.lap_rank === null ? null : Number(row.lap_rank),
    timeRank: Number(row.time_rank),
  }));
  const entry = (row: (typeof racers)[number], rank: number) => ({
    fastestLapMicroseconds: row.fastest_lap_microseconds,
    kartName: row.kart_name,
    rank,
    timeMicroseconds: row.time_microseconds,
    username: row.username,
    viewer: row.user_id === viewerUserId,
  });
  const viewer = racers.find((row) => row.user_id === viewerUserId);

  return {
    board: {
      courseName: published.courseName,
      entries: racers
        .filter((row) => row.timeRank <= BOARD_SIZE)
        .sort((left, right) => left.timeRank - right.timeRank)
        .map((row) => entry(row, row.timeRank)),
      lapEntries: racers
        .filter((row) => row.lapRank !== null && row.lapRank <= BOARD_SIZE)
        .sort((left, right) => left.lapRank! - right.lapRank!)
        .map((row) => entry(row, row.lapRank!)),
      viewer: viewer
        ? {
            fastestLap:
              viewer.lapRank === null
                ? null
                : {
                    rank: viewer.lapRank,
                    timeMicroseconds: viewer.fastest_lap_microseconds!,
                  },
            rank: viewer.timeRank,
            timeMicroseconds: viewer.time_microseconds,
          }
        : null,
    },
    earlier,
  };
}

/**
 * The current board's number and how many racers have a time on it, for the
 * publish dialog. Null before the board's first run.
 */
export async function loadCurrentBoardSummary(courseId: string) {
  const published = await loadLatestPublishedRevision(courseId);
  if (!published) return null;
  const leaderboardId = await findLeaderboard(db, {
    courseId,
    courseRevision: published.revision,
    physicsVersion: CURRENT_PHYSICS_VERSION,
  });
  if (leaderboardId === null) return null;
  const {
    rows: [board],
  } = await db.execute<{ number: number; racers: number }>(sql`
    select board.number, count(best.user_id)::int as racers
    from leaderboards board
    left join board_bests best on best.leaderboard_id = board.id
    where board.id = ${leaderboardId}
    group by board.number
  `);
  return board ?? null;
}

/**
 * A board's course best, or one racer's best, as a ghost record: its
 * recording and what drawing its kart needs, from that kart revision. Only
 * the current board's: earlier course versions' ghosts raced a layout that
 * changed.
 */
export async function loadBoardGhost(
  courseId: string,
  courseRevision: number,
  userId: string | null,
) {
  if (!(await isOnCurrentBoard(courseId, courseRevision))) return null;
  const leaderboardId = await findLeaderboard(db, {
    courseId,
    courseRevision,
    physicsVersion: CURRENT_PHYSICS_VERSION,
  });
  if (leaderboardId === null) return null;
  const {
    rows: [best],
  } = await db.execute<{
    document: unknown;
    ghost: Buffer;
    resolved_snapshot: unknown;
    time_microseconds: number;
  }>(sql`
    select kart.document, kart.resolved_snapshot, best.ghost,
      best.time_microseconds
    from board_bests best
    join race_results result on result.id = best.result_id
    join kart_revisions kart
      on kart.kart_id = result.kart_id and kart.revision = result.kart_revision
    where best.leaderboard_id = ${leaderboardId}
      ${userId === null ? sql`` : sql`and best.user_id = ${userId}`}
    order by best.time_microseconds, best.achieved_at, best.user_id
    limit 1
  `);
  if (!best) return null;
  // Stored in older versions too; sent as the client reads them now.
  const document = parseKartAssemblyDocument(best.document);
  const { geometry, massProperties } = parseResolvedKartSnapshot(
    best.resolved_snapshot,
  );
  return {
    courseId,
    courseRevision,
    kart: {
      centerOfMass: massProperties.centerOfMass,
      document,
      wheels: geometry.wheelStations.map(({ id, radius, steered }) => ({
        id,
        radius,
        steered,
      })),
    },
    timeMicroseconds: best.time_microseconds,
    trace: best.ghost.toString("base64"),
  };
}

/**
 * A course's newest published revision and a racer found by their public
 * username, so a link names no internal ID. A username a racer kept when
 * another was brought into it finds that racer. Null without either, or for
 * a deleted racer.
 */
async function findLinkedRacer(courseId: string, username: string) {
  const published = await loadLatestPublishedRevision(courseId);
  if (!published) return null;
  const [racer] = (
    await db.execute<{ id: string; username: string }>(sql`
      select id, username from users
      where username = ${username} and anonymized_at is null
      union all
      select users.id, users.username from racer_former_usernames former
      join users on users.id = former.user_id
      where former.username = ${username} and users.anonymized_at is null
      limit 1
    `)
  ).rows;
  return racer ? { published, userId: racer.id, username: racer.username } : null;
}

/**
 * A racer's best on a course's current board as a ghost, by their public
 * username. Null when they have no best there.
 */
export async function loadRacerGhost(courseId: string, username: string) {
  const linked = await findLinkedRacer(courseId, username);
  if (!linked) return null;
  return loadBoardGhost(courseId, linked.published.revision, linked.userId);
}

/**
 * A racer's standing on a course's current board, for a ghost link's
 * preview: their best time and rank, without the recording. Null when they
 * have no best there.
 */
export async function loadRacerStanding(courseId: string, username: string) {
  const linked = await findLinkedRacer(courseId, username);
  if (!linked) return null;
  const leaderboardId = await findLeaderboard(db, {
    courseId,
    courseRevision: linked.published.revision,
    physicsVersion: CURRENT_PHYSICS_VERSION,
  });
  if (leaderboardId === null) return null;
  const standing = await racerStanding(db, leaderboardId, linked.userId);
  if (!standing) return null;
  return {
    courseName: linked.published.courseName,
    entries: standing.entries,
    rank: standing.rank,
    timeMicroseconds: standing.best,
    username: linked.username,
  };
}
