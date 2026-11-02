import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  boardBests,
  courseMedals,
  leaderboards,
  raceResults,
} from "@/db/schema";
import { LEADERBOARD_COURSE_IDS } from "@/game/course/course-ids";
import {
  decodeGhostTrace,
  GhostTraceFormatError,
  ghostTraceFromBase64,
} from "@/game/ghost/ghost-trace";
import { OFFICIAL_KART_IDS } from "@/game/kart/official-kart-roster";
import { CURRENT_PHYSICS_VERSION } from "@/game/physics/physics-version";
import { createRaceSessionConfig } from "@/game/race/race-course";
import { earnedMedalTiers, MEDAL_TIERS } from "@/game/race/race-medals";
import type { RaceSessionConfig } from "@/game/race/race-session";
import {
  type RunRejection,
  verifyRaceRecording,
} from "@/game/race/race-verification";
import type { RunSubmissionResponse } from "@/game/race/run-submission";
import {
  loadCourseRevisionDocument,
  wasCourseRevisionPublished,
} from "@/server/course-repository";
import { wasKartRevisionPublished } from "@/server/kart-repository";
import type { RunTicket } from "@/server/run-tickets";

type LeaderboardRace = Pick<
  RunTicket,
  "courseId" | "courseRevision" | "kartId" | "kartRevision" | "physicsVersion"
>;

/**
 * A run counts on the official course in an official kart, both at a
 * published revision, under the current physics. Tests pass their own IDs.
 */
export async function isLeaderboardRace(
  race: LeaderboardRace,
  {
    courseIds = LEADERBOARD_COURSE_IDS,
    kartIds = OFFICIAL_KART_IDS,
  }: { courseIds?: readonly string[]; kartIds?: readonly string[] } = {},
) {
  if (
    race.physicsVersion !== CURRENT_PHYSICS_VERSION ||
    !courseIds.includes(race.courseId) ||
    !kartIds.includes(race.kartId)
  ) {
    return false;
  }
  const [course, kart] = await Promise.all([
    wasCourseRevisionPublished(race.courseId, race.courseRevision),
    wasKartRevisionPublished(race.kartId, race.kartRevision),
  ]);
  return course && kart;
}

// Revisions never change, so their gates are built once per server.
const raceConfigs = new Map<string, RaceSessionConfig>();

async function loadRaceConfig(courseId: string, revision: number) {
  const key = `${courseId}:${revision}`;
  const cached = raceConfigs.get(key);
  if (cached) return cached;
  const document = await loadCourseRevisionDocument(courseId, revision);
  if (!document) return null;
  const config = createRaceSessionConfig(document);
  raceConfigs.set(key, config);
  return config;
}

type CheckedRun =
  | { ghost: Uint8Array; timeMicroseconds: number; verified: true }
  | { reason: RunRejection; verified: false };

/**
 * The server's own check of a submitted recording: it must decode, pass the
 * gate re-check, and finish no sooner after its ticket than the race took.
 */
export async function checkSubmittedRun(
  ticket: RunTicket,
  recording: string,
  now = Date.now(),
): Promise<CheckedRun | null> {
  const config = await loadRaceConfig(ticket.courseId, ticket.courseRevision);
  if (!config) return null;
  let ghost: Uint8Array;
  let samples;
  try {
    ghost = ghostTraceFromBase64(recording);
    samples = decodeGhostTrace(ghost);
  } catch (error) {
    if (error instanceof GhostTraceFormatError) {
      return { reason: "bad-recording", verified: false };
    }
    throw error;
  }
  const verdict = verifyRaceRecording(config, samples);
  if (!verdict.verified) return verdict;
  if ((now - ticket.issuedAt) * 1_000 < verdict.timeMicroseconds) {
    return { reason: "too-early", verified: false };
  }
  return { ghost, timeMicroseconds: verdict.timeMicroseconds, verified: true };
}

/**
 * Stores a submitted run under its ticket's ID, so each ticket counts once.
 * A verified run replaces the racer's best on its board only when faster,
 * and is granted each medal tier it earns that the racer does not hold.
 */
export async function recordRunSubmission(
  ticket: RunTicket,
  run: CheckedRun,
): Promise<RunSubmissionResponse | "duplicate"> {
  return db.transaction(async (transaction) => {
    const board = and(
      eq(leaderboards.courseId, ticket.courseId),
      eq(leaderboards.courseRevision, ticket.courseRevision),
      eq(leaderboards.physicsVersion, ticket.physicsVersion),
    );
    const findBoard = () =>
      transaction
        .select({
          developerMicroseconds: raceResults.timeMicroseconds,
          leaderboardId: leaderboards.id,
        })
        .from(leaderboards)
        .leftJoin(
          raceResults,
          eq(raceResults.id, leaderboards.developerResultId),
        )
        .where(board);
    let [found] = await findBoard();
    if (!found) {
      // The first run on a board creates it; a racing first run may too.
      await transaction
        .insert(leaderboards)
        .values({
          courseId: ticket.courseId,
          courseRevision: ticket.courseRevision,
          physicsVersion: ticket.physicsVersion,
        })
        .onConflictDoNothing();
      [found] = await findBoard();
    }
    const { developerMicroseconds, leaderboardId } = found;

    const stored = await transaction
      .insert(raceResults)
      .values({
        id: ticket.id,
        kartId: ticket.kartId,
        kartRevision: ticket.kartRevision,
        leaderboardId,
        rejection: run.verified ? null : run.reason,
        status: run.verified ? "verified" : "rejected",
        ticketIssuedAt: new Date(ticket.issuedAt),
        timeMicroseconds: run.verified ? run.timeMicroseconds : null,
        userId: ticket.userId,
      })
      .onConflictDoNothing()
      .returning({ id: raceResults.id });
    if (stored.length === 0) return "duplicate";
    if (!run.verified) return { reason: run.reason, status: "rejected" };

    const improved = await transaction
      .insert(boardBests)
      .values({
        // The submission's own timestamp, at full precision, orders ties.
        achievedAt: sql`now()`,
        ghost: Buffer.from(run.ghost),
        leaderboardId,
        resultId: ticket.id,
        timeMicroseconds: run.timeMicroseconds,
        userId: ticket.userId,
      })
      .onConflictDoUpdate({
        set: {
          achievedAt: sql`excluded.achieved_at`,
          ghost: sql`excluded.ghost`,
          resultId: sql`excluded.result_id`,
          timeMicroseconds: sql`excluded.time_microseconds`,
        },
        setWhere: sql`
          ${boardBests.timeMicroseconds} > excluded.time_microseconds
        `,
        target: [boardBests.leaderboardId, boardBests.userId],
      })
      .returning({ userId: boardBests.userId });

    const {
      rows: [standing],
    } = await transaction.execute<{
      best: number;
      entries: number;
      rank: number;
    }>(sql`
      select
        mine.time_microseconds as best,
        count(*)::int as entries,
        1 + (count(*) filter (
          where (other.time_microseconds, other.achieved_at, other.user_id)
            < (mine.time_microseconds, mine.achieved_at, mine.user_id)
        ))::int as rank
      from ${boardBests} mine
      join ${boardBests} other on other.leaderboard_id = mine.leaderboard_id
      where mine.leaderboard_id = ${leaderboardId}
        and mine.user_id = ${ticket.userId}
      group by mine.time_microseconds, mine.achieved_at, mine.user_id
    `);

    const granted = await transaction
      .insert(courseMedals)
      .values(
        earnedMedalTiers(run.timeMicroseconds, developerMicroseconds).map(
          (tier) => ({
            courseId: ticket.courseId,
            resultId: ticket.id,
            tier,
            userId: ticket.userId,
          }),
        ),
      )
      .onConflictDoNothing()
      .returning({ tier: courseMedals.tier });
    const held = new Set(
      (
        await transaction
          .select({ tier: courseMedals.tier })
          .from(courseMedals)
          .where(
            and(
              eq(courseMedals.userId, ticket.userId),
              eq(courseMedals.courseId, ticket.courseId),
            ),
          )
      ).map(({ tier }) => tier),
    );
    const newTiers = new Set(granted.map(({ tier }) => tier));

    return {
      entries: standing.entries,
      medal: {
        newTiers: MEDAL_TIERS.filter((tier) => newTiers.has(tier)),
        // A verified run always holds at least the finish tier.
        tier: [...MEDAL_TIERS].reverse().find((tier) => held.has(tier))!,
      },
      personalBest: {
        improved: improved.length > 0,
        timeMicroseconds: standing.best,
      },
      rank: standing.rank,
      status: "verified",
      timeMicroseconds: run.timeMicroseconds,
    };
  });
}
