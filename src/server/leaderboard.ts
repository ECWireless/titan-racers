import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { CURRENT_PHYSICS_VERSION } from "@/game/physics/physics-version";
import { parseKartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import { parseResolvedKartSnapshot } from "@/game/kart/kart-derivation";
import type { LeaderboardResponse } from "@/game/race/leaderboard";
import { loadLatestPublishedRevision } from "@/server/course-repository";
import {
  findLeaderboard,
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
      board: { courseName: published.courseName, entries: [], viewer: null },
      earlier,
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
 * recording and what drawing its kart needs, from that kart revision.
 */
export async function loadBoardGhost(
  courseId: string,
  courseRevision: number,
  userId: string | null,
) {
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
 * username, so a link names no internal ID. Null without either, or for a
 * racer who no longer has that username.
 */
async function findLinkedRacer(courseId: string, username: string) {
  const published = await loadLatestPublishedRevision(courseId);
  if (!published) return null;
  const [racer] = (
    await db.execute<{ id: string }>(sql`
      select id from users
      where username = ${username} and anonymized_at is null
    `)
  ).rows;
  return racer ? { published, userId: racer.id } : null;
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
    username,
  };
}
